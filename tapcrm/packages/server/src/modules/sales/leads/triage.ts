/**
 * Sales v1.1 — triage queue manager actions (R1 plan step 1.16).
 *
 *   list           → leads in `bid_state = 'triage'`, scoped per role
 *                    (supervisor sees own pool, HOD + Super Admin see all)
 *   rescue         → reassign to a specific agent; writes a
 *                    `sales_routing_decision { mode: 'triage_rescue' }`
 *                    so analytics can distinguish from ordinary reassigns
 *   returnToPool   → re-expand the lead into the bid pool after the
 *                    availability picture changed
 *   close          → mark the lead rejected / closed_lost with a reason
 */

import { z } from 'zod';
import { visibilityFilter } from '@tapcrm/authz';
import type { RequestContext } from '../../../platform/dal/context.js';
import { db } from '../../../platform/dal/db.js';
import { sql } from '../../../platform/dal/sql.js';
import { ApplicationError } from '../../../errors.js';
import { enterBidPool } from '../bidding/service.js';
import { insertRoutingDecision } from '../intake/repository.js';
import { emitLeadReassigned } from '../realtime/sales-channel.js';
import { addBusinessMinutesSimple, OPERATIONAL_TZ } from '../../../platform/time.js';
import { insertActivity, insertAudit } from './repository.js';
import { LeadNotFoundError } from './errors.js';

export const TRIAGE_ERROR_CODES = {
  NOT_IN_TRIAGE: 'LEAD_NOT_IN_TRIAGE',
  INVALID_INPUT: 'TRIAGE_INPUT_INVALID',
} as const;

export class TriageInvalidStateError extends ApplicationError {
  constructor(leadId: string, state: string) {
    super(`Lead ${leadId} is in state '${state}', expected 'triage'`, 409, TRIAGE_ERROR_CODES.NOT_IN_TRIAGE, { state });
    this.name = 'TriageInvalidStateError';
  }
}

export const triageRescueBodySchema = z.object({
  newOwnerId: z.string().uuid(),
  reason: z.string().trim().min(5).max(500),
});

export const triageCloseBodySchema = z.object({
  reason: z.string().trim().min(5).max(500),
  lossReason: z
    .enum(['not_interested', 'no_budget', 'no_need', 'competitor', 'unqualified', 'timing', 'duplicate', 'other', 'unspecified'])
    .default('unqualified'),
});

export interface TriageRow {
  readonly leadId: string;
  readonly leadNumber: string;
  readonly contactName: string;
  readonly sourceName: string;
  readonly service: string | null;
  readonly location: string | null;
  readonly ageSeconds: number;
  readonly reason: string | null;
  readonly salesPoolId: string | null;
  readonly salesTeamId: string | null;
}

export async function listTriage(ctx: RequestContext): Promise<TriageRow[]> {
  const scope = await visibilityFilter(ctx, 'leads:view', 'lead');
  const rows = await db.query<{
    leadId: string;
    leadNumber: string;
    contactName: string;
    sourceName: string;
    service: string | null;
    location: string | null;
    ageSeconds: string;
    reason: string | null;
    salesPoolId: string | null;
    salesTeamId: string | null;
  }>(
    ctx,
    sql`
      SELECT l.id                                                     AS "leadId",
             l.lead_number::text                                      AS "leadNumber",
             l.contact_name                                           AS "contactName",
             ls.name                                                  AS "sourceName",
             (sub.normalized_payload->>'serviceRequested')            AS "service",
             (sub.normalized_payload->>'location')                    AS "location",
             EXTRACT(EPOCH FROM (now() - COALESCE(l.bid_pool_expires_at, l.updated_at)))::text AS "ageSeconds",
             (
               SELECT reason FROM sales_routing_decision d
                WHERE d.organization_id = l.organization_id AND d.lead_id = l.id
                ORDER BY d.created_at DESC LIMIT 1
             )                                                        AS reason,
             l.sales_pool_id                                          AS "salesPoolId",
             l.sales_team_id                                          AS "salesTeamId"
        FROM lead l
        JOIN lead_source ls ON ls.organization_id = l.organization_id AND ls.id = l.source_id
        LEFT JOIN LATERAL (
          SELECT normalized_payload
            FROM lead_submission
           WHERE organization_id = l.organization_id AND lead_id = l.id
           ORDER BY source_received_at DESC LIMIT 1
        ) sub ON true
       WHERE l.organization_id = ${ctx.organizationId}
         AND l.bid_state       = 'triage'
         AND ${scope}
       ORDER BY l.updated_at ASC
       LIMIT 200
    `,
  );
  return rows.map((row) => ({
    leadId: row.leadId,
    leadNumber: row.leadNumber,
    contactName: row.contactName,
    sourceName: row.sourceName,
    service: row.service,
    location: row.location,
    ageSeconds: Math.max(0, Math.round(Number(row.ageSeconds))),
    reason: row.reason,
    salesPoolId: row.salesPoolId,
    salesTeamId: row.salesTeamId,
  }));
}

export interface RescueInput {
  readonly newOwnerId: string;
  readonly reason: string;
}

export async function rescueFromTriage(
  ctx: RequestContext,
  leadId: string,
  input: RescueInput,
): Promise<{ leadId: string; newOwnerId: string }> {
  const now = new Date();
  await db.transaction(ctx, async (tx) => {
    const row = await tx.maybeOne<{ bidState: string; ownerId: string | null; currentHolderId: string | null; originatingAgentId: string | null }>(sql`
      SELECT bid_state              AS "bidState",
             owner_id                AS "ownerId",
             current_holder_id       AS "currentHolderId",
             originating_agent_id    AS "originatingAgentId"
        FROM lead
       WHERE organization_id = ${ctx.organizationId} AND id = ${leadId}
       FOR UPDATE
    `);
    if (!row) throw new LeadNotFoundError();
    if (row.bidState !== 'triage') throw new TriageInvalidStateError(leadId, row.bidState);

    const slaDue = addBusinessMinutesSimple(now, 10, OPERATIONAL_TZ);
    await tx.query(sql`
      UPDATE lead
         SET bid_state                = 'claimed',
             owner_id                 = ${input.newOwnerId},
             current_holder_id        = ${input.newOwnerId},
             originating_agent_id     = COALESCE(originating_agent_id, ${input.newOwnerId}),
             routing_status           = 'assigned',
             status                   = CASE WHEN status = 'new' THEN 'assigned' ELSE status END,
             claimed_at               = ${now},
             sla_first_contact_due_at = ${slaDue},
             updated_at               = ${now}
       WHERE organization_id = ${ctx.organizationId}
         AND id              = ${leadId}
    `);

    await insertRoutingDecision(tx, ctx.organizationId, {
      leadId,
      mode: 'triage_rescue',
      rulesVersion: null,
      candidateSnapshot: null,
      result: {
        from: { ownerId: row.ownerId, currentHolderId: row.currentHolderId },
        to: { ownerId: input.newOwnerId, currentHolderId: input.newOwnerId },
      },
      reason: `triage_rescue: ${input.reason}`,
      actorId: ctx.principal.id,
    });

    await insertAudit(tx, ctx, 'lead.triage_rescued', leadId,
      { ownerId: row.ownerId, currentHolderId: row.currentHolderId, bidState: 'triage' },
      { ownerId: input.newOwnerId, currentHolderId: input.newOwnerId, bidState: 'claimed', reason: input.reason },
    );
  });

  emitLeadReassigned(ctx.organizationId, [input.newOwnerId], {
    leadId,
    fromUserId: null,
    toUserId: input.newOwnerId,
    reason: `triage_rescue: ${input.reason}`,
    reassignedAt: now.toISOString(),
    sourcingCreditTransferred: false,
  });
  return { leadId, newOwnerId: input.newOwnerId };
}

export async function returnToBidPool(ctx: RequestContext, leadId: string): Promise<{ leadId: string }> {
  const now = new Date();
  await db.transaction(ctx, async (tx) => {
    const row = await tx.maybeOne<{ bidState: string; salesPoolId: string | null }>(sql`
      SELECT bid_state AS "bidState", sales_pool_id AS "salesPoolId"
        FROM lead
       WHERE organization_id = ${ctx.organizationId} AND id = ${leadId}
       FOR UPDATE
    `);
    if (!row) throw new LeadNotFoundError();
    if (row.bidState !== 'triage') throw new TriageInvalidStateError(leadId, row.bidState);
    if (!row.salesPoolId) throw new TriageInvalidStateError(leadId, 'triage_no_pool');

    // Flip back to `none` so enterBidPool's `WHERE bid_state = 'none'` guard allows
    // the transition to pool_open; same pattern the expire worker uses in reverse.
    await tx.query(sql`
      UPDATE lead SET bid_state = 'none', updated_at = ${now}
       WHERE organization_id = ${ctx.organizationId} AND id = ${leadId}
    `);
    await enterBidPool(ctx, tx, { leadId, salesPoolId: row.salesPoolId }, now);
    await insertRoutingDecision(tx, ctx.organizationId, {
      leadId,
      mode: 'triage_rescue',
      rulesVersion: null,
      candidateSnapshot: null,
      result: { returnedToPool: true },
      reason: 'triage_return_to_pool',
      actorId: ctx.principal.id,
    });
    await insertAudit(tx, ctx, 'lead.triage_returned_to_pool', leadId, { bidState: 'triage' }, { bidState: 'pool_open' });
  });
  return { leadId };
}

export interface CloseFromTriageInput {
  readonly reason: string;
  readonly lossReason: 'not_interested' | 'no_budget' | 'no_need' | 'competitor' | 'unqualified' | 'timing' | 'duplicate' | 'other' | 'unspecified';
}

export async function closeFromTriage(
  ctx: RequestContext,
  leadId: string,
  input: CloseFromTriageInput,
): Promise<{ leadId: string }> {
  const now = new Date();
  await db.transaction(ctx, async (tx) => {
    const row = await tx.maybeOne<{ bidState: string; status: string }>(sql`
      SELECT bid_state AS "bidState", status
        FROM lead
       WHERE organization_id = ${ctx.organizationId} AND id = ${leadId}
       FOR UPDATE
    `);
    if (!row) throw new LeadNotFoundError();
    if (row.bidState !== 'triage') throw new TriageInvalidStateError(leadId, row.bidState);

    await tx.query(sql`
      UPDATE lead
         SET lead_outcome = 'closed_lost',
             status       = 'closed_lost',
             loss_reason  = ${input.lossReason},
             lost_at      = ${now},
             updated_at   = ${now}
       WHERE organization_id = ${ctx.organizationId}
         AND id              = ${leadId}
    `);
    await insertActivity(tx, ctx.organizationId, leadId, 'lead.closed_lost', ctx.principal.id, {
      from: 'triage',
      reason: input.reason,
      lossReason: input.lossReason,
    });
    await insertAudit(tx, ctx, 'lead.triage_closed', leadId,
      { bidState: 'triage', status: row.status },
      { bidState: 'triage', status: 'closed_lost', lossReason: input.lossReason, reason: input.reason },
    );
  });
  return { leadId };
}
