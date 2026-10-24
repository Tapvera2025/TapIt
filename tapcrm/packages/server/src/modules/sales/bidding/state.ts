/**
 * Sales v1.1 — bidding state transitions (PRD §8.3).
 *
 * Pure DB operations: no availability check, no realtime emit, no job
 * enqueue. Those side effects live in service.ts; this module exists so
 * the state machine can be unit-tested and reused by the expire worker
 * and the direct-assignment router (R1.4) without pulling in the
 * socket layer.
 */

import { OPERATIONAL_TZ, addBusinessMinutesSimple, addMinutesInZone } from '../../../platform/time.js';
import type { Tx } from '../../../platform/dal/db.js';
import { sql } from '../../../platform/dal/sql.js';

export const BID_POOL_TIMEOUT_MINUTES = 10;
export const PASS_COOLING_MINUTES = 5;

export { BidPoolAlreadyClaimedError, BidPoolInvalidStateError } from './errors.js';

export interface BidPoolLockedLead {
  readonly id: string;
  readonly salesPoolId: string | null;
  readonly salesTeamId: string | null;
  readonly bidState: 'none' | 'pool_open' | 'claimed' | 'triage' | 'fallback_assigned';
  readonly currentHolderId: string | null;
  readonly ownerId: string | null;
  readonly originatingAgentId: string | null;
}

/** Row-level lock on a lead for the duration of the transaction. */
export async function lockLeadForBidding(tx: Tx, organizationId: string, leadId: string): Promise<BidPoolLockedLead | null> {
  return tx.maybeOne<BidPoolLockedLead>(sql`
    SELECT id,
           sales_pool_id         AS "salesPoolId",
           sales_team_id         AS "salesTeamId",
           bid_state             AS "bidState",
           current_holder_id     AS "currentHolderId",
           owner_id              AS "ownerId",
           originating_agent_id  AS "originatingAgentId"
    FROM lead
    WHERE organization_id = ${organizationId} AND id = ${leadId}
    FOR UPDATE
  `);
}

/**
 * Transition the lead from `none` → `pool_open`. Called by the intake
 * service for connector kinds we want to broadcast to agents. The
 * `expiresAt` is wall-clock + 10 minutes (bid-pool deadline is a
 * real-world responsiveness measure, not a business-hour SLA).
 */
export async function openBidPool(tx: Tx, organizationId: string, leadId: string, now: Date): Promise<Date> {
  const expiresAt = addMinutesInZone(now, BID_POOL_TIMEOUT_MINUTES, OPERATIONAL_TZ);
  await tx.query(sql`
    UPDATE lead
       SET bid_state           = 'pool_open',
           bid_pool_opened_at  = ${now},
           bid_pool_expires_at = ${expiresAt},
           updated_at          = ${now}
     WHERE organization_id = ${organizationId}
       AND id              = ${leadId}
       AND bid_state       = 'none'
  `);
  return expiresAt;
}

/**
 * Atomic claim transition. The caller must hold a FOR UPDATE lock on
 * the lead (via lockLeadForBidding) before calling. Writes:
 *   - bid_state = 'claimed'
 *   - current_holder_id, owner_id = agentId
 *   - originating_agent_id = agentId if previously null (bidding is
 *     where sourcing credit is first set for external L1 leads)
 *   - claimed_at = now
 *   - routing_status = 'assigned'
 *   - sla_first_contact_due_at = now + 10 business minutes
 *     (business time, not wall clock — this clock is for the agent's
 *     work window, unlike the bid-pool expiry which is wall clock)
 *
 * Returns the SLA due instant so the caller can report it back to the
 * client.
 */
export async function markClaimed(
  tx: Tx,
  organizationId: string,
  leadId: string,
  agentId: string,
  now: Date,
): Promise<{ slaFirstContactDueAt: Date }> {
  const slaFirstContactDueAt = addBusinessMinutesSimple(now, 10, OPERATIONAL_TZ);
  await tx.query(sql`
    UPDATE lead
       SET bid_state                = 'claimed',
           current_holder_id        = ${agentId},
           owner_id                 = ${agentId},
           originating_agent_id     = COALESCE(originating_agent_id, ${agentId}),
           claimed_at               = ${now},
           routing_status           = 'assigned',
           sla_first_contact_due_at = ${slaFirstContactDueAt},
           status                   = CASE WHEN status = 'new' THEN 'assigned' ELSE status END,
           updated_at               = ${now}
     WHERE organization_id = ${organizationId}
       AND id              = ${leadId}
  `);
  return { slaFirstContactDueAt };
}

/**
 * Upsert a bid_pool_view row for the acting agent. Used in three
 * places: pre-emptive `viewed` on card display, `passed` on a Pass
 * action, and `claimed` on a successful claim.
 */
export async function recordView(
  tx: Tx,
  organizationId: string,
  leadId: string,
  agentId: string,
  action: 'viewed' | 'passed' | 'claimed',
  passReason: string | null,
  passUntil: Date | null,
  now: Date,
): Promise<void> {
  await tx.query(sql`
    INSERT INTO bid_pool_view (organization_id, lead_id, agent_id, action, pass_reason, pass_until, first_seen_at, last_seen_at)
    VALUES (${organizationId}, ${leadId}, ${agentId}, ${action}, ${passReason}, ${passUntil}, ${now}, ${now})
    ON CONFLICT (organization_id, lead_id, agent_id) DO UPDATE
      SET action       = EXCLUDED.action,
          pass_reason  = EXCLUDED.pass_reason,
          pass_until   = EXCLUDED.pass_until,
          last_seen_at = EXCLUDED.last_seen_at
  `);
}

/**
 * Transition a bid-pool lead to triage. Called by the expire worker
 * when the fallback router found no eligible agent.
 */
export async function markTriage(tx: Tx, organizationId: string, leadId: string, now: Date): Promise<void> {
  await tx.query(sql`
    UPDATE lead
       SET bid_state  = 'triage',
           updated_at = ${now}
     WHERE organization_id = ${organizationId}
       AND id              = ${leadId}
  `);
}

/**
 * Transition a bid-pool lead to fallback_assigned. Called by the
 * expire worker when the direct-assignment router picked an agent
 * after the pool timed out.
 */
export async function markFallbackAssigned(
  tx: Tx,
  organizationId: string,
  leadId: string,
  agentId: string,
  now: Date,
): Promise<{ slaFirstContactDueAt: Date }> {
  const slaFirstContactDueAt = addBusinessMinutesSimple(now, 10, OPERATIONAL_TZ);
  await tx.query(sql`
    UPDATE lead
       SET bid_state                = 'fallback_assigned',
           current_holder_id        = ${agentId},
           owner_id                 = ${agentId},
           originating_agent_id     = COALESCE(originating_agent_id, ${agentId}),
           claimed_at               = ${now},
           routing_status           = 'assigned',
           sla_first_contact_due_at = ${slaFirstContactDueAt},
           status                   = CASE WHEN status = 'new' THEN 'assigned' ELSE status END,
           updated_at               = ${now}
     WHERE organization_id = ${organizationId}
       AND id              = ${leadId}
  `);
  return { slaFirstContactDueAt };
}

export function computePassUntil(now: Date): Date {
  return addMinutesInZone(now, PASS_COOLING_MINUTES, OPERATIONAL_TZ);
}
