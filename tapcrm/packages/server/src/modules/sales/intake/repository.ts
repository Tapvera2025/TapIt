/**
 * Sales v1.1 — intake-side repositories (PRD §6, §20.2).
 *
 * Four surfaces:
 *   - sales_connector lookup (read-only here; CRUD lives in connectors module)
 *   - lead_submission insert and outcome update
 *   - contact and company read/write for dedupe-driven linking
 *   - lead_from_intake insert that writes the v1.1 columns the legacy
 *     insertLead does not know about (contact_id, company_id,
 *     entry_method, direction, originating_agent_id, bid_state,
 *     lead_stage, lead_outcome)
 *
 * Every write runs inside a Tx opened by the service orchestrator; the
 * one SELECT taken before Tx is the connector lookup, which is safe
 * because connectors are long-lived.
 */

import type { RequestContext } from '../../../platform/dal/context.js';
import { db, type Tx } from '../../../platform/dal/db.js';
import { sql } from '../../../platform/dal/sql.js';
import { OPERATIONAL_TZ, deriveTimezoneFromPhoneE164 } from '../../../platform/time.js';
import type { ConnectorKind, EntryMethod, SubmissionOutcome } from './types.js';

// ---------------------------------------------------------------------------
// Connector lookup
// ---------------------------------------------------------------------------

export interface ConnectorRow {
  readonly id: string;
  readonly organizationId: string;
  readonly kind: ConnectorKind;
  readonly name: string;
  readonly status:
    | 'draft'
    | 'testing'
    | 'active'
    | 'degraded'
    | 'reconnect_required'
    | 'paused'
    | 'disconnected';
  readonly config: Record<string, unknown>;
  readonly externalAccountId: string | null;
}

export async function findConnector(ctx: RequestContext, connectorId: string): Promise<ConnectorRow | null> {
  return db.maybeOne<ConnectorRow>(
    ctx,
    sql`
      SELECT id, organization_id AS "organizationId", kind, name, status,
             config, external_account_id AS "externalAccountId"
      FROM sales_connector
      WHERE organization_id = ${ctx.organizationId} AND id = ${connectorId}
    `,
  );
}

// ---------------------------------------------------------------------------
// Lead submission
// ---------------------------------------------------------------------------

export interface InsertSubmissionInput {
  readonly connectorId: string;
  readonly externalLeadId: string | null;
  readonly externalFormId: string | null;
  readonly providerSubmittedAt: Date | null;
  readonly sourceReceivedAt: Date;
  readonly rawPayload: Buffer | null;
  readonly rawPayloadDigest: string | null;
  readonly normalizedPayload: unknown;
  readonly mappingVersion: string | null;
}

export interface InsertSubmissionResult {
  readonly submissionId: string;
  /** True when a prior submission existed with the same external key. */
  readonly isDuplicateDelivery: boolean;
  /** The lead_id attached to that prior submission, if any. */
  readonly priorLeadId: string | null;
  /** The outcome recorded on the prior submission. */
  readonly priorOutcome: SubmissionOutcome | null;
}

/**
 * Idempotent insert on the (org, connector, external_lead_id) partial
 * unique index. On conflict, returns the existing submission's id and
 * its linked lead so the caller can short-circuit to `duplicate_delivery`.
 *
 * For submissions without an external key (manual, import), the service
 * layer must supply its own idempotency guard (import row key, manual
 * idempotency header).
 */
export async function insertSubmission(tx: Tx, organizationId: string, input: InsertSubmissionInput): Promise<InsertSubmissionResult> {
  // Pre-check: if an external key is present, a prior submission with the same
  // (org, connector, external_lead_id) short-circuits as duplicate. The unique
  // partial index is still the ultimate guard (two concurrent inserts in flight
  // would still have one fail on the index), but the pre-check gives us a
  // deterministic branch in the common replay case.
  if (input.externalLeadId !== null) {
    const prior = await tx.maybeOne<{ id: string; leadId: string | null; outcome: SubmissionOutcome }>(sql`
      SELECT id, lead_id AS "leadId", outcome
      FROM lead_submission
      WHERE organization_id = ${organizationId}
        AND connector_id    = ${input.connectorId}
        AND external_lead_id = ${input.externalLeadId}
      LIMIT 1
    `);
    if (prior) {
      return {
        submissionId: prior.id,
        isDuplicateDelivery: true,
        priorLeadId: prior.leadId,
        priorOutcome: prior.outcome,
      };
    }
  }

  const inserted = await tx.one<{ id: string }>(sql`
    INSERT INTO lead_submission (
      organization_id, connector_id, external_lead_id, external_form_id,
      provider_submitted_at, source_received_at,
      raw_payload_encrypted, raw_payload_digest, normalized_payload, mapping_version
    ) VALUES (
      ${organizationId}, ${input.connectorId}, ${input.externalLeadId}, ${input.externalFormId},
      ${input.providerSubmittedAt}, ${input.sourceReceivedAt},
      ${input.rawPayload}, ${input.rawPayloadDigest},
      ${JSON.stringify(input.normalizedPayload)}::jsonb, ${input.mappingVersion}
    )
    RETURNING id
  `);
  return {
    submissionId: inserted.id,
    isDuplicateDelivery: false,
    priorLeadId: null,
    priorOutcome: null,
  };
}

export async function markSubmissionOutcome(
  tx: Tx,
  organizationId: string,
  submissionId: string,
  outcome: SubmissionOutcome,
  reason: string | null,
  leadId: string | null,
): Promise<void> {
  await tx.query(sql`
    UPDATE lead_submission
       SET outcome            = ${outcome},
           outcome_reason     = ${reason},
           lead_id            = COALESCE(${leadId}, lead_id),
           first_processed_at = COALESCE(first_processed_at, now())
     WHERE organization_id = ${organizationId}
       AND id              = ${submissionId}
  `);
}

// ---------------------------------------------------------------------------
// Contact + company
// ---------------------------------------------------------------------------

export interface ContactMatch {
  readonly id: string;
  readonly companyId: string | null;
  readonly preferredTimezone: string;
  readonly optOut: Record<string, unknown>;
}

export async function findContactByPhoneOrEmail(
  tx: Tx,
  organizationId: string,
  phoneE164: string | null,
  email: string | null,
): Promise<ContactMatch | null> {
  if (!phoneE164 && !email) return null;
  return tx.maybeOne<ContactMatch>(sql`
    SELECT id,
           company_id         AS "companyId",
           preferred_timezone AS "preferredTimezone",
           opt_out            AS "optOut"
    FROM contact
    WHERE organization_id = ${organizationId}
      AND (
            (${phoneE164}::text IS NOT NULL AND primary_phone = ${phoneE164})
        OR (${email}::text    IS NOT NULL AND primary_email = ${email})
      )
    ORDER BY (primary_phone IS NOT NULL AND primary_phone = ${phoneE164}) DESC
    LIMIT 1
  `);
}

export interface InsertContactInput {
  readonly fullName: string | null;
  readonly phoneE164: string | null;
  readonly phoneRaw: string | null;
  readonly email: string | null;
  readonly companyId: string | null;
  readonly createdBy: string;
}

export async function insertContact(tx: Tx, organizationId: string, input: InsertContactInput): Promise<string> {
  const timezone = input.phoneE164 ? deriveTimezoneFromPhoneE164(input.phoneE164) ?? OPERATIONAL_TZ : OPERATIONAL_TZ;
  const row = await tx.one<{ id: string }>(sql`
    INSERT INTO contact (
      organization_id, full_name,
      primary_phone, primary_phone_raw, primary_email,
      company_id, preferred_timezone, created_by
    ) VALUES (
      ${organizationId}, ${input.fullName},
      ${input.phoneE164}, ${input.phoneRaw}, ${input.email},
      ${input.companyId}, ${timezone}, ${input.createdBy}
    )
    RETURNING id
  `);
  return row.id;
}

export async function findOrInsertCompanyByName(
  tx: Tx,
  organizationId: string,
  name: string | null,
  createdBy: string,
): Promise<string | null> {
  if (!name) return null;
  const trimmed = name.trim();
  if (!trimmed) return null;
  const existing = await tx.maybeOne<{ id: string }>(sql`
    SELECT id FROM company
    WHERE organization_id = ${organizationId} AND lower(name) = lower(${trimmed})
    LIMIT 1
  `);
  if (existing) return existing.id;
  const inserted = await tx.one<{ id: string }>(sql`
    INSERT INTO company (organization_id, name, created_by)
    VALUES (${organizationId}, ${trimmed}, ${createdBy})
    RETURNING id
  `);
  return inserted.id;
}

// ---------------------------------------------------------------------------
// Lead insert (intake path)
// ---------------------------------------------------------------------------

export interface InsertLeadFromIntakeInput {
  readonly sourceId: string;
  readonly campaignId: string | null;
  readonly contactId: string;
  readonly companyId: string | null;
  readonly contactName: string;        // kept on lead for legacy readers
  readonly companyName: string | null;
  readonly phone: string | null;
  readonly email: string | null;
  readonly phoneNormalized: string | null;
  readonly emailNormalized: string | null;
  readonly entryMethod: EntryMethod;
  readonly direction: 'inbound' | 'outbound';
  readonly originatingAgentId: string | null;
  readonly ownerId: string | null;
  readonly salesPoolId: string | null;
  readonly salesTeamId: string | null;
  readonly createdBy: string;
}

/**
 * Writes a lead with the full v1.1 column set. Legacy fields are
 * populated so old readers keep working. `bid_state` stays 'none' here;
 * the caller flips it to 'pool_open' via `enterBidPool()` once the lead
 * is persisted and the sales_pool_id is resolved.
 */
export async function insertLeadFromIntake(
  tx: Tx,
  organizationId: string,
  input: InsertLeadFromIntakeInput,
): Promise<string> {
  const legacyStatus = input.ownerId ? 'assigned' : 'new';
  const row = await tx.one<{ id: string }>(sql`
    INSERT INTO lead (
      organization_id, source_id, campaign_id,
      contact_id, company_id,
      contact_name, company_name, phone, email,
      phone_normalized, email_normalized,
      entry_method, direction, originating_agent_id,
      owner_id, current_holder_id,
      sales_team_id, sales_pool_id,
      status, routing_status,
      lead_stage, lead_outcome,
      created_by
    ) VALUES (
      ${organizationId}, ${input.sourceId}, ${input.campaignId},
      ${input.contactId}, ${input.companyId},
      ${input.contactName}, ${input.companyName}, ${input.phone}, ${input.email},
      ${input.phoneNormalized}, ${input.emailNormalized},
      ${input.entryMethod}, ${input.direction}, ${input.originatingAgentId},
      ${input.ownerId}, ${input.ownerId},
      ${input.salesTeamId}, ${input.salesPoolId},
      ${legacyStatus}, ${input.ownerId ? 'assigned' : 'unrouted'},
      'new', 'active',
      ${input.createdBy}
    )
    RETURNING id
  `);
  return row.id;
}

// ---------------------------------------------------------------------------
// Routing audit
// ---------------------------------------------------------------------------

export interface InsertRoutingDecisionInput {
  readonly leadId: string;
  readonly mode: 'bidding' | 'direct' | 'fallback' | 'reassignment' | 'triage_rescue';
  readonly rulesVersion: string | null;
  readonly candidateSnapshot: unknown;
  readonly result: unknown;
  readonly reason: string | null;
  readonly actorId: string | null;
}

export async function insertRoutingDecision(
  tx: Tx,
  organizationId: string,
  input: InsertRoutingDecisionInput,
): Promise<void> {
  await tx.query(sql`
    INSERT INTO sales_routing_decision (
      organization_id, lead_id, mode, rules_version,
      candidate_snapshot, result, reason, actor_id
    ) VALUES (
      ${organizationId}, ${input.leadId}, ${input.mode}, ${input.rulesVersion},
      ${JSON.stringify(input.candidateSnapshot)}::jsonb,
      ${JSON.stringify(input.result)}::jsonb,
      ${input.reason}, ${input.actorId}
    )
  `);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function digitsOnlyPhone(e164OrRaw: string | null): string | null {
  if (!e164OrRaw) return null;
  const digits = e164OrRaw.replace(/\D/g, '');
  return digits || null;
}

/** Legacy lowercased-trimmed form; kept writing it so old reads still work. */
export function legacyEmailNormalized(email: string | null): string | null {
  if (!email) return null;
  const t = email.trim().toLowerCase();
  return t || null;
}

export const _unused_tz = OPERATIONAL_TZ;
