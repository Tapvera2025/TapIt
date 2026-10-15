/**
 * Sales v1.1 — bidding orchestrator (PRD §8, R1 plan step 1.3).
 *
 * The service composes the pure state transitions in state.ts with the
 * availability facade, the fairness guards, the realtime emitter and
 * the expire-worker scheduler. Routes call these functions.
 */

import type { RequestContext } from '../../../platform/dal/context.js';
import { db, type Tx } from '../../../platform/dal/db.js';
import { sql } from '../../../platform/dal/sql.js';
import { evaluateAvailability } from '../../../platform/availability/service.js';
import { NotEligibleError } from '../../../platform/http/error-handler.js';
import { insertRoutingDecision } from '../intake/repository.js';
import {
  emitBidPoolAdded,
  emitBidPoolRemoved,
  emitLeadClaimed,
  type MaskedBidCard,
} from '../realtime/sales-channel.js';
import { assignOne } from '../routing/direct-router.js';
import { checkFairness } from './fairness.js';
import {
  BidPoolAlreadyClaimedError,
  BidPoolInvalidStateError,
  BidPoolLeadNotFoundError,
} from './errors.js';
import { maskEmail, maskName, maskPhone, truncateMessage } from './mask.js';
import {
  BID_POOL_TIMEOUT_MINUTES,
  computePassUntil,
  lockLeadForBidding,
  markClaimed,
  markFallbackAssigned,
  markTriage,
  openBidPool,
  recordView,
} from './state.js';

function throwNotEligible(reasons: readonly string[]): never {
  throw new NotEligibleError('NOT_ELIGIBLE', `bid pool: caller not eligible: ${reasons.join(', ')}`, {
    unmet: reasons.length > 0 ? reasons : ['not_active'],
  });
}

// ---------------------------------------------------------------------------
// Enter the pool (called from intake and from expire-worker reversal paths)
// ---------------------------------------------------------------------------

export interface EnterBidPoolInput {
  readonly leadId: string;
  readonly salesPoolId: string;
}

/**
 * Move a lead from `none` into `pool_open`, resolve the eligible-agent
 * list, emit the add event, and schedule the expire-worker. Returns
 * the eligible agents so the caller can log the snapshot into the
 * routing_decision audit.
 */
export async function enterBidPool(
  ctx: RequestContext,
  tx: Tx,
  input: EnterBidPoolInput,
  now: Date,
): Promise<{ eligibleAgentIds: string[]; expiresAt: Date }> {
  const expiresAt = await openBidPool(tx, ctx.organizationId, input.leadId, now);

  const poolAgents = await listPoolMembers(tx, ctx.organizationId, input.salesPoolId);
  const availability = poolAgents.length === 0
    ? []
    : await evaluateAvailability(ctx, poolAgents, { pool: 'bidding' });
  const eligibleAgentIds = availability.filter((a) => a.eligible).map((a) => a.userId);

  // No per-lead expire enqueue: the scheduled sweep (sales.bid-pool.expire,
  // every 30s per organization) consumes all pool_open leads whose
  // bid_pool_expires_at has elapsed. That removes the "schedule a delayed
  // job" dependency and keeps the state authoritative in the DB.
  return { eligibleAgentIds, expiresAt };
}

/**
 * After-commit publisher. Call this once the surrounding transaction
 * has committed so clients do not see a card for a row that may be
 * rolled back. Separated from enterBidPool for clarity.
 */
export function announceBidPoolAdded(
  organizationId: string,
  eligibleAgentIds: readonly string[],
  card: MaskedBidCard,
): void {
  emitBidPoolAdded(organizationId, eligibleAgentIds, { card });
}

// ---------------------------------------------------------------------------
// Claim
// ---------------------------------------------------------------------------

export interface ClaimResult {
  readonly leadId: string;
  readonly claimedByUserId: string;
  readonly claimedAt: Date;
  readonly slaFirstContactDueAt: Date;
}

export async function claim(ctx: RequestContext, leadId: string): Promise<ClaimResult> {
  // Availability is cheap enough to check before opening the transaction;
  // we check again inside with service_unavailable fail-closed semantics
  // if any dependency hiccups.
  const [preCheck] = await evaluateAvailability(ctx, [ctx.principal.id], { pool: 'bidding' });
  if (!preCheck || !preCheck.eligible) {
    throwNotEligible(preCheck ? preCheck.reasons : ['not_active']);
  }

  const result = await db.transaction(ctx, async (tx) => {
    const lead = await lockLeadForBidding(tx, ctx.organizationId, leadId);
    if (!lead) throw new BidPoolLeadNotFoundError(leadId);
    if (lead.bidState !== 'pool_open') {
      // Lost the race or state regressed.
      throw new BidPoolAlreadyClaimedError(leadId, lead.currentHolderId);
    }

    // Hard fairness enforcement — the availability facade already soft-rejected
    // `at_capacity` during the pre-check, but this is the only guard that
    // survives a stale snapshot or a client that bypasses the UI.
    await checkFairness(tx, ctx.organizationId, ctx.principal.id);

    const now = new Date();
    const { slaFirstContactDueAt } = await markClaimed(tx, ctx.organizationId, leadId, ctx.principal.id, now);
    await recordView(tx, ctx.organizationId, leadId, ctx.principal.id, 'claimed', null, null, now);
    await insertRoutingDecision(tx, ctx.organizationId, {
      leadId,
      mode: 'bidding',
      rulesVersion: null,
      candidateSnapshot: null,
      result: { claimedBy: ctx.principal.id, claimedAt: now.toISOString() },
      reason: 'claim',
      actorId: ctx.principal.id,
    });

    return { leadId, claimedByUserId: ctx.principal.id, claimedAt: now, slaFirstContactDueAt };
  });

  // Post-commit: remove the card from everyone else; notify detail subscribers.
  emitBidPoolRemoved(ctx.organizationId, [ctx.principal.id], { leadId, reason: 'claimed' });
  emitLeadClaimed(ctx.organizationId, [ctx.principal.id], {
    leadId,
    claimedByUserId: ctx.principal.id,
    claimedAt: result.claimedAt.toISOString(),
  });

  return result;
}

// ---------------------------------------------------------------------------
// Pass
// ---------------------------------------------------------------------------

export type PassReason = 'wrong_location' | 'out_of_expertise' | 'at_capacity' | 'other';

export async function pass(ctx: RequestContext, leadId: string, reason: PassReason): Promise<void> {
  const now = new Date();
  const until = computePassUntil(now);
  await db.transaction(ctx, async (tx) => {
    // No lock needed: pass only writes the per-agent view row. The lead's
    // bid_state is unchanged — the card simply disappears from this agent's
    // view until pass_until elapses (and even then only if the lead is
    // still in the pool).
    const lead = await tx.maybeOne<{ id: string; bidState: string }>(sql`
      SELECT id, bid_state AS "bidState"
      FROM lead
      WHERE organization_id = ${ctx.organizationId} AND id = ${leadId}
    `);
    if (!lead) throw new BidPoolLeadNotFoundError(leadId);
    if (lead.bidState !== 'pool_open') throw new BidPoolInvalidStateError(leadId, lead.bidState);
    await recordView(tx, ctx.organizationId, leadId, ctx.principal.id, 'passed', reason, until, now);
  });

  emitBidPoolRemoved(ctx.organizationId, [ctx.principal.id], { leadId, reason: 'passed' });
}

// ---------------------------------------------------------------------------
// Expire (called by the bid-pool.expire worker)
// ---------------------------------------------------------------------------

export interface ExpireResult {
  readonly leadId: string;
  readonly outcome: 'noop_claimed' | 'triaged' | 'fallback_assigned';
  readonly assignedToUserId?: string;
}

/**
 * Process an expired pool_open lead. Try the direct-assignment fallback
 * router (R1.4): if it finds an eligible agent, transition the lead to
 * `fallback_assigned`; otherwise send it to triage.
 */
export async function expire(ctx: RequestContext, leadId: string): Promise<ExpireResult> {
  const now = new Date();
  const result = await db.transaction(ctx, async (tx) => {
    const lead = await lockLeadForBidding(tx, ctx.organizationId, leadId);
    if (!lead) throw new BidPoolLeadNotFoundError(leadId);
    if (lead.bidState !== 'pool_open') {
      // Already claimed or already triaged — this job is a no-op.
      return { leadId, outcome: 'noop_claimed' as const };
    }

    const assignment = await assignOne(ctx, tx, {
      id: lead.id,
      organizationId: ctx.organizationId,
      salesPoolId: lead.salesPoolId,
      salesTeamId: lead.salesTeamId,
    });

    if (assignment) {
      await markFallbackAssigned(tx, ctx.organizationId, leadId, assignment.userId, now);
      await insertRoutingDecision(tx, ctx.organizationId, {
        leadId,
        mode: 'fallback',
        rulesVersion: null,
        candidateSnapshot: assignment.candidates,
        result: { assignedToUserId: assignment.userId, weightedScore: assignment.weightedScore },
        reason: 'bid_pool_timeout_fallback_router',
        actorId: null,
      });
      return {
        leadId,
        outcome: 'fallback_assigned' as const,
        assignedToUserId: assignment.userId,
      };
    }

    await markTriage(tx, ctx.organizationId, leadId, now);
    await insertRoutingDecision(tx, ctx.organizationId, {
      leadId,
      mode: 'fallback',
      rulesVersion: null,
      candidateSnapshot: null,
      result: { triaged: true },
      reason: 'bid_pool_timeout_no_fallback',
      actorId: null,
    });
    return { leadId, outcome: 'triaged' as const };
  });

  if (result.outcome === 'triaged' || result.outcome === 'fallback_assigned') {
    emitBidPoolRemoved(ctx.organizationId, [], { leadId, reason: 'expired' });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Read: list bid-pool cards visible to caller + fetch a single card
// ---------------------------------------------------------------------------

export interface BidCardRow {
  readonly leadId: string;
  readonly fullName: string | null;
  readonly phone: string | null;
  readonly email: string | null;
  readonly companyName: string | null;
  readonly service: string | null;
  readonly location: string | null;
  readonly budgetBracket: string | null;
  readonly timeline: string | null;
  readonly message: string | null;
  readonly sourceName: string;
  readonly campaignName: string | null;
  readonly createdAt: Date;
  readonly expiresAt: Date;
}

/**
 * Return bid-pool cards the caller should see right now:
 *   - lead is in `pool_open`
 *   - the caller is a member of the lead's sales pool
 *   - the caller has not passed the lead within the cooling window
 *
 * No availability check here — availability is enforced at claim time.
 * A viewer going on break still sees the pool; they just cannot claim.
 */
const BID_CARD_SELECT = sql`
  SELECT l.id                   AS "leadId",
         c.full_name            AS "fullName",
         c.primary_phone        AS "phone",
         c.primary_email        AS "email",
         l.company_name         AS "companyName",
         (sub.normalized_payload->>'serviceRequested') AS "service",
         (sub.normalized_payload->>'location')         AS "location",
         (sub.normalized_payload->>'budgetBracket')    AS "budgetBracket",
         (sub.normalized_payload->>'timeline')         AS "timeline",
         (sub.normalized_payload->>'message')          AS "message",
         s.name                 AS "sourceName",
         camp.name              AS "campaignName",
         l.bid_pool_opened_at   AS "createdAt",
         l.bid_pool_expires_at  AS "expiresAt"
  FROM lead l
  JOIN contact c      ON c.organization_id    = l.organization_id AND c.id    = l.contact_id
  JOIN lead_source s  ON s.organization_id    = l.organization_id AND s.id    = l.source_id
  LEFT JOIN campaign camp ON camp.organization_id = l.organization_id AND camp.id = l.campaign_id
  LEFT JOIN LATERAL (
    SELECT normalized_payload
    FROM lead_submission ls
    WHERE ls.organization_id = l.organization_id AND ls.lead_id = l.id
    ORDER BY ls.source_received_at DESC
    LIMIT 1
  ) sub ON true
`;

export async function listBidPool(ctx: RequestContext): Promise<MaskedBidCard[]> {
  const rows = await db.query<BidCardRow>(ctx, sql`
    ${BID_CARD_SELECT}
    WHERE l.organization_id = ${ctx.organizationId}
      AND l.bid_state       = 'pool_open'
      AND l.sales_pool_id IN (
        SELECT team_id FROM app_user
         WHERE organization_id = ${ctx.organizationId}
           AND id              = ${ctx.principal.id}
           AND team_id         IS NOT NULL
      )
      AND NOT EXISTS (
        SELECT 1 FROM bid_pool_view bpv
         WHERE bpv.organization_id = l.organization_id
           AND bpv.lead_id         = l.id
           AND bpv.agent_id        = ${ctx.principal.id}
           AND bpv.action          = 'passed'
           AND bpv.pass_until      > now()
      )
    ORDER BY l.bid_pool_opened_at ASC
    LIMIT 100
  `);
  return rows.map(toMaskedCard);
}

export async function getBidCard(ctx: RequestContext, leadId: string): Promise<MaskedBidCard | null> {
  const row = await db.maybeOne<BidCardRow>(ctx, sql`
    ${BID_CARD_SELECT}
    WHERE l.organization_id = ${ctx.organizationId}
      AND l.id              = ${leadId}
      AND l.bid_state       = 'pool_open'
  `);
  return row ? toMaskedCard(row) : null;
}

/**
 * Scheduled sweep for the bid-pool expire job. Finds every `pool_open`
 * lead in this tenant whose `bid_pool_expires_at` has elapsed, calls
 * `expire()` on each, and returns the count processed. Safe to run on
 * a 30-second cadence; each row-level lock protects against a
 * concurrent claim on the same lead.
 */
export async function sweepExpired(ctx: RequestContext): Promise<number> {
  const rows = await db.query<{ id: string }>(ctx, sql`
    SELECT id FROM lead
    WHERE organization_id    = ${ctx.organizationId}
      AND bid_state          = 'pool_open'
      AND bid_pool_expires_at IS NOT NULL
      AND bid_pool_expires_at < now()
    ORDER BY bid_pool_expires_at ASC
    LIMIT 100
  `);
  let processed = 0;
  for (const row of rows) {
    try {
      const result = await expire(ctx, row.id);
      if (result.outcome !== 'noop_claimed') processed++;
    } catch (err) {
      console.error(JSON.stringify({ level: 'error', msg: 'sales.bid-pool.sweepExpired item failed', leadId: row.id, err: String(err) }));
    }
  }
  return processed;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function listPoolMembers(tx: Tx, organizationId: string, salesPoolId: string): Promise<string[]> {
  const rows = await tx.query<{ userId: string }>(sql`
    SELECT id AS "userId"
    FROM app_user
    WHERE organization_id = ${organizationId}
      AND team_id         = ${salesPoolId}
      AND status          = 'active'
  `);
  return rows.map((r) => r.userId);
}

function toMaskedCard(row: BidCardRow): MaskedBidCard {
  return {
    leadId: row.leadId,
    source: row.sourceName,
    campaign: row.campaignName,
    service: row.service,
    location: row.location,
    budgetBracket: row.budgetBracket,
    timeline: row.timeline,
    messagePreview: truncateMessage(row.message, 80),
    maskedName: maskName(row.fullName),
    maskedPhone: maskPhone(row.phone),
    maskedEmail: row.email ? maskEmail(row.email) : null,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
  };
}

export const _consts = { BID_POOL_TIMEOUT_MINUTES };
