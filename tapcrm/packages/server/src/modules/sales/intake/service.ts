/**
 * Sales v1.1 — canonical intake service (PRD §6.2, R1 plan step 1.1).
 *
 * One entry point: `ingest()`. Called by every external adapter after
 * normalising its provider payload into an `IntakePayload`. Owns the
 * dedupe → identify → classify → persist pipeline inside one DB
 * transaction (PRD R-INT-01 "connectors must not write directly to
 * lead tables").
 *
 * What this R1.1 cut does NOT yet do:
 *   - put the lead into the bid pool (R1.3 wires that on top: when
 *     the connector kind is external L1 and the pool has eligible
 *     agents, flip bid_state to 'pool_open' and enqueue the expire job)
 *   - run the direct-assignment fewest-open-leads router (R1.4)
 *   - encrypt the raw payload (needs the platform KMS wiring)
 *   - fire the first-contact SLA activity (needs the activity module
 *     schema update that lives in R1.18)
 *
 * All of those are additive: a later increment adds steps between the
 * current `insertLead` and the `markSubmissionOutcome` call.
 */

import { createHash } from 'node:crypto';

import type { RequestContext } from '../../../platform/dal/context.js';
import { db } from '../../../platform/dal/db.js';
import { enterBidPool, getBidCard, announceBidPoolAdded } from '../bidding/service.js';
import { dedupeAndIdentify } from './dedupe.js';
import {
  findConnector,
  findOrInsertCompanyByName,
  insertLeadFromIntake,
  insertRoutingDecision,
  insertSubmission,
  legacyEmailNormalized,
  markSubmissionOutcome,
  digitsOnlyPhone,
} from './repository.js';
import type { ConnectorKind, EntryMethod, IngestResult, IntakePayload } from './types.js';
import { validateIntake } from './validator.js';

export class IntakeConnectorNotFoundError extends Error {
  constructor(public readonly connectorId: string) {
    super(`sales intake: connector not found: ${connectorId}`);
    this.name = 'IntakeConnectorNotFoundError';
  }
}

export class IntakeConnectorInactiveError extends Error {
  constructor(public readonly connectorId: string, public readonly status: string) {
    super(`sales intake: connector ${connectorId} is ${status}, not active`);
    this.name = 'IntakeConnectorInactiveError';
  }
}

/**
 * Normalise, dedupe, persist. Returns the final submission outcome plus
 * (if any) the lead_id it ended up linked to.
 *
 * The function is safe to call again with the same `(connectorId,
 * externalLeadId)` — the second call sees the unique-index conflict,
 * reads the prior submission's recorded outcome, and short-circuits
 * with `duplicate_delivery`. The caller does not have to track
 * processed events.
 */
export async function ingest(ctx: RequestContext, payload: IntakePayload): Promise<IngestResult> {
  const connector = await findConnector(ctx, payload.connectorId);
  if (!connector) throw new IntakeConnectorNotFoundError(payload.connectorId);
  if (connector.status === 'disconnected' || connector.status === 'paused') {
    throw new IntakeConnectorInactiveError(payload.connectorId, connector.status);
  }

  const connectorConfig = connector.config ?? {};
  const defaultCountryCode = asString(connectorConfig['defaultCountryCode']) ?? null;
  const requireService = Boolean(connectorConfig['requireService']);

  const validation = validateIntake(payload.mappedFields, { defaultCountryCode, requireService });
  const sourceReceivedAt = payload.sourceReceivedAt ?? new Date();

  // The sourceId mapping is config-driven: a connector points at exactly one
  // lead_source so attribution is deterministic across replays.
  const sourceId = asString(connectorConfig['sourceId']);
  if (!sourceId) {
    throw new Error(
      `sales intake: connector ${connector.id} is missing config.sourceId; configure a lead_source before activating this connector`,
    );
  }
  const campaignId = asString(connectorConfig['campaignId']) ?? null;
  const serviceSelf = ctx.principal.id;
  const connectorKind: ConnectorKind = connector.kind;
  const entryMethod = toEntryMethod(connectorKind);
  const direction = (asString(connectorConfig['direction']) ?? 'inbound') as 'inbound' | 'outbound';

  const rawPayloadDigest = payload.rawPayload ? sha256Hex(payload.rawPayload) : null;

  return db.transaction(ctx, async (tx) => {
    // Step 2 + 3: durable submission insert with idempotency on external key.
    const inserted = await insertSubmission(tx, ctx.organizationId, {
      connectorId: connector.id,
      externalLeadId: payload.externalLeadId ?? null,
      externalFormId: payload.externalFormId ?? null,
      providerSubmittedAt: payload.providerSubmittedAt ?? null,
      sourceReceivedAt,
      rawPayload: payload.rawPayload ?? null,
      rawPayloadDigest,
      normalizedPayload: payload.mappedFields,
      mappingVersion: payload.mappingVersion ?? null,
    });

    if (inserted.isDuplicateDelivery) {
      // A prior submission already landed. This call is the webhook replay;
      // report `duplicate_delivery` as the outcome of THIS attempt and surface
      // the prior lead so the adapter can log the linkage without having to
      // look it up again. The prior submission row keeps its original outcome.
      const result: IngestResult = {
        outcome: 'duplicate_delivery',
        submissionId: inserted.submissionId,
        reason: `prior_outcome:${inserted.priorOutcome ?? 'unknown'}`,
        ...(inserted.priorLeadId ? { leadId: inserted.priorLeadId } : {}),
      };
      return result;
    }

    // Step 4: validate contact fields before touching contact/lead tables.
    if (!validation.ok) {
      await markSubmissionOutcome(tx, ctx.organizationId, inserted.submissionId, 'quarantined', validation.reason, null);
      const result: IngestResult = {
        outcome: 'quarantined',
        submissionId: inserted.submissionId,
        reason: validation.reason,
      };
      return result;
    }

    const { contact } = validation;
    const phoneNormalized = digitsOnlyPhone(contact.phoneE164 ?? contact.phoneRaw);
    const emailNormalized = legacyEmailNormalized(contact.email);

    // Step 5 (company): resolve or create a company when the payload names one.
    const companyName = asStringOrNull(payload.mappedFields.companyName);
    const companyId = await findOrInsertCompanyByName(tx, ctx.organizationId, companyName, serviceSelf);

    // Step 6: dedupe → either new contact row, link to an existing enquiry,
    // or create a new linked lead against an existing contact.
    const dedupe = await dedupeAndIdentify(tx, ctx.organizationId, {
      phoneE164: contact.phoneE164,
      email: contact.email,
      fullName: contact.fullName,
      phoneRaw: contact.phoneRaw,
      companyId,
      serviceRequested: asStringOrNull(payload.mappedFields.serviceRequested),
      createdBy: serviceSelf,
    });

    if (dedupe.mode === 'linked_existing_enquiry' && dedupe.existingLeadId) {
      await markSubmissionOutcome(
        tx,
        ctx.organizationId,
        inserted.submissionId,
        'linked_existing',
        'active_lead_exists',
        dedupe.existingLeadId,
      );
      const result: IngestResult = {
        outcome: 'linked_existing',
        submissionId: inserted.submissionId,
        leadId: dedupe.existingLeadId,
        reason: 'active_lead_exists',
      };
      return result;
    }

    // Step 7: create the lead. Pool is config-driven on the connector until
    // the territory matcher is rewritten (R1.4). salesPoolId pre-sets the
    // sales_pool_id/sales_team_id so bidding can enter the pool immediately.
    const salesPoolId = asString(connectorConfig['defaultSalesPoolId']) ?? null;
    const salesTeamId = asString(connectorConfig['defaultSalesTeamId']) ?? null;

    const leadId = await insertLeadFromIntake(tx, ctx.organizationId, {
      sourceId,
      campaignId,
      contactId: dedupe.contact.id,
      companyId,
      contactName: contact.fullName ?? '(unknown)',
      companyName,
      phone: contact.phoneE164 ?? contact.phoneRaw,
      email: contact.email,
      phoneNormalized,
      emailNormalized,
      entryMethod,
      direction,
      originatingAgentId: null,
      ownerId: null,
      salesPoolId,
      salesTeamId,
      createdBy: serviceSelf,
    });

    // Step 8: decide bidding vs direct. External L1 sources with a resolved
    // pool enter the bid pool. Everything else records a direct-routing
    // placeholder decision for the R1.4 router to pick up.
    const now = new Date();
    let shouldAnnounceAfterCommit = false;
    let eligibleAgentsSnapshot: string[] = [];
    if (shouldBidForKind(connectorKind) && salesPoolId) {
      const bidResult = await enterBidPool(ctx, tx, { leadId, salesPoolId }, now);
      eligibleAgentsSnapshot = bidResult.eligibleAgentIds;
      shouldAnnounceAfterCommit = eligibleAgentsSnapshot.length > 0;
      await insertRoutingDecision(tx, ctx.organizationId, {
        leadId,
        mode: 'bidding',
        rulesVersion: null,
        candidateSnapshot: eligibleAgentsSnapshot,
        result: { bidPoolExpiresAt: bidResult.expiresAt.toISOString() },
        reason: 'external_source_entered_pool',
        actorId: null,
      });
    } else {
      await insertRoutingDecision(tx, ctx.organizationId, {
        leadId,
        mode: 'direct',
        rulesVersion: null,
        candidateSnapshot: null,
        result: { assigned: false, reason: 'r1.1_pending_direct_router' },
        reason: 'non_bidding_or_no_pool',
        actorId: null,
      });
    }

    await markSubmissionOutcome(
      tx,
      ctx.organizationId,
      inserted.submissionId,
      'created',
      dedupe.reason,
      leadId,
    );

    // Side effect carried out of the transaction (safe only after commit).
    if (shouldAnnounceAfterCommit) {
      // Schedule after-commit emit via microtask so the DB transaction
      // commits first. Re-read the card so masking happens post-persist.
      queueMicrotask(() => {
        void getBidCard(ctx, leadId)
          .then((card) => {
            if (card) announceBidPoolAdded(ctx.organizationId, eligibleAgentsSnapshot, card);
          })
          .catch((err) => {
             
            console.error(JSON.stringify({ level: 'error', msg: 'bid-pool.added announce failed', leadId, err: String(err) }));
          });
      });
    }

    const result: IngestResult = {
      outcome: 'created',
      submissionId: inserted.submissionId,
      leadId,
      reason: dedupe.reason,
    };
    return result;
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sha256Hex(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

function toEntryMethod(kind: ConnectorKind): EntryMethod {
  switch (kind) {
    case 'website':
      return 'website';
    case 'meta':
    case 'gbp':
    case 'whatsapp':
      return 'provider_webhook';
    case 'email':
      return 'provider_poll';
    case 'import':
      return 'import';
    case 'partner':
      return 'partner_api';
  }
}

/**
 * External L1 inbound sources that join the bidding pool by default
 * (PRD lock L1 + L2). Email and WhatsApp wait for the classifier
 * (R1.8/1.9); until then they take the direct path.
 */
function shouldBidForKind(kind: ConnectorKind): boolean {
  return kind === 'website' || kind === 'meta' || kind === 'gbp';
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function asStringOrNull(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t || null;
}
