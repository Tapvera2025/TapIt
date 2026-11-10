/**
 * Sales v1.1 — lead reassignment service (R1 plan step 1.5).
 *
 * The route framework already authorized `leads:reassign`. This service
 * performs:
 *   - a secondary `leads:reassign-with-credit` check when the caller asks
 *     to transfer sourcing credit (the plan reserves credit-move to
 *     Super Admin only via the `leads:reassign-with-credit` policy);
 *   - the new owner must be an active person in Sales; whether they are
 *     punched in, on a break or on leave is shown in the picker but does not
 *     block (leads are handed out before shifts and to cover absences, the
 *     same rule as imported leads);
 *   - the lead joins the new owner's pool and Sales Team, so their
 *     Supervisor and Team Lead see it (and the previous ones stop seeing it);
 *   - the state transition, callback owner transfer, routing-decision
 *     audit, lead activity entry, outbox notifications to the previous
 *     holder and the new owner, realtime emit.
 */

import { z } from 'zod';
import { effectivePolicy } from '@tapcrm/authz';
import { globalAccess } from '@tapcrm/contracts';
import type { RequestContext } from '../../../platform/dal/context.js';
import { db } from '../../../platform/dal/db.js';
import { sql } from '../../../platform/dal/sql.js';
import { PlatformForbiddenError } from '../../../platform/errors.js';
import { NotEligibleError } from '../../../platform/http/error-handler.js';
import { loadSalesAssignee } from './assignees.js';
import { notify } from '../../notifications/facade.js';
import { insertRoutingDecision } from '../intake/repository.js';
import { emitLeadReassigned } from '../realtime/sales-channel.js';
import { findLeadTx, insertActivity, insertAudit } from './repository.js';
import { LeadNotFoundError } from './errors.js';
import type { Lead } from './types.js';

export interface ReassignInput {
  readonly newOwnerId: string;
  readonly reason: string;
  readonly transferPendingCallbacks: boolean;
  readonly transferScheduledActivities: boolean;
  readonly transferSourcingCredit: boolean;
}

export const reassignBodySchema = z.object({
  newOwnerId: z.string().uuid(),
  reason: z.string().trim().min(5).max(500),
  transferPendingCallbacks: z.boolean().default(true),
  transferScheduledActivities: z.boolean().default(true),
  transferSourcingCredit: z.boolean().default(false),
});

export interface LockedLeadForReassign {
  readonly id: string;
  readonly ownerId: string | null;
  readonly currentHolderId: string | null;
  readonly originatingAgentId: string | null;
  readonly leadOutcome: string;
}

export async function reassign(
  ctx: RequestContext,
  leadId: string,
  input: ReassignInput,
): Promise<Lead> {
  // Secondary authorization: only principals with `leads:reassign-with-credit`
  // may flip the originating-agent column. The route framework already proved
  // the caller holds `leads:reassign`, so this guard is the only thing that
  // prevents an HOD from silently acquiring credit.
  if (input.transferSourcingCredit && !globalAccess(ctx.principal)) {
    const policy = await effectivePolicy(ctx, 'leads:reassign-with-credit');
    if (!policy?.allowed) {
      throw new PlatformForbiddenError(
        'Transferring sourcing credit requires leads:reassign-with-credit',
      );
    }
  }

  // Scope guard: an agent with `leads:reassign` at `own` scope can push
  // their own lead to another user through the API. Only self-return (new
  // owner == caller) is allowed at that scope; cross-user reassignment
  // demands pool/team/department reach.
  if (!globalAccess(ctx.principal) && input.newOwnerId !== ctx.principal.id) {
    const policy = await effectivePolicy(ctx, 'leads:reassign');
    const scope = policy?.allowed ? policy.scope : null;
    if (scope === 'own' || scope === 'participant' || scope === null) {
      throw new PlatformForbiddenError(
        'Reassigning a lead to another user requires leads:reassign at pool scope or wider',
      );
    }
  }

  const now = new Date();
  const result = await db.transaction(ctx, async (tx) => {
    const assignee = await loadSalesAssignee(tx, ctx.organizationId, input.newOwnerId);
    if (!assignee) {
      throw new NotEligibleError(
        'NOT_ELIGIBLE',
        'Leads can only go to active people in Sales. Refresh the list and pick again.',
        { unmet: ['not_active'] },
      );
    }
    const locked = await tx.maybeOne<LockedLeadForReassign>(sql`
      SELECT id,
             owner_id              AS "ownerId",
             current_holder_id     AS "currentHolderId",
             originating_agent_id  AS "originatingAgentId",
             lead_outcome          AS "leadOutcome"
      FROM lead
      WHERE organization_id = ${ctx.organizationId} AND id = ${leadId}
      FOR UPDATE
    `);
    if (!locked) throw new LeadNotFoundError();

    const previousHolderId = locked.currentHolderId;
    const previousOwnerId = locked.ownerId;
    const previousOriginatingAgentId = locked.originatingAgentId;
    const nextOriginatingAgentId = input.transferSourcingCredit
      ? input.newOwnerId
      : previousOriginatingAgentId;

    await tx.query(sql`
      UPDATE lead
         SET owner_id             = ${input.newOwnerId},
             current_holder_id    = ${input.newOwnerId},
             originating_agent_id = ${nextOriginatingAgentId},
             sales_pool_id        = COALESCE(${assignee.poolId}::uuid, sales_pool_id),
             sales_team_id        = COALESCE(${assignee.teamId}::uuid, sales_team_id),
             routing_status       = 'assigned',
             status               = CASE WHEN status = 'new' THEN 'assigned' ELSE status END,
             updated_at           = ${now}
       WHERE organization_id = ${ctx.organizationId}
         AND id              = ${leadId}
    `);

    // The lead's open callback follows it to the new owner. This includes one
    // left with someone else, so reassigning a lead to its current holder
    // also hands them its callback.
    let callbacksMoved = 0;
    if (input.transferPendingCallbacks) {
      const moved = await tx.query<{ id: string }>(sql`
        UPDATE lead_callback
           SET owner_id   = ${input.newOwnerId},
               updated_at = ${now}
         WHERE organization_id = ${ctx.organizationId}
           AND lead_id         = ${leadId}
           AND status          = 'pending'
           AND owner_id       <> ${input.newOwnerId}
        RETURNING id
      `);
      callbacksMoved = moved.length;
    }

    await insertRoutingDecision(tx, ctx.organizationId, {
      leadId,
      mode: 'reassignment',
      rulesVersion: null,
      candidateSnapshot: null,
      result: {
        from: { ownerId: previousOwnerId, currentHolderId: previousHolderId },
        to: { ownerId: input.newOwnerId, currentHolderId: input.newOwnerId },
        originatingAgentId: {
          before: previousOriginatingAgentId,
          after: nextOriginatingAgentId,
        },
      },
      reason: input.reason,
      actorId: ctx.principal.id,
    });

    await insertAudit(
      tx,
      ctx,
      'lead.reassigned',
      leadId,
      {
        ownerId: previousOwnerId,
        currentHolderId: previousHolderId,
        originatingAgentId: previousOriginatingAgentId,
      },
      {
        ownerId: input.newOwnerId,
        currentHolderId: input.newOwnerId,
        originatingAgentId: nextOriginatingAgentId,
        reason: input.reason,
        transferSourcingCredit: input.transferSourcingCredit,
      },
    );

    await insertActivity(
      tx,
      ctx.organizationId,
      leadId,
      'lead.reassigned',
      ctx.principal.id,
      { previousOwnerId, ownerId: input.newOwnerId, callbacksMoved },
    );

    if (previousHolderId !== input.newOwnerId && input.newOwnerId !== ctx.principal.id) {
      await notify(tx, ctx, {
        type: 'lead.assigned',
        priority: 'operational',
        audience: { users: [input.newOwnerId] },
        title: 'Lead assigned to you',
        body:
          callbacksMoved > 0
            ? 'A lead has been reassigned to you, along with its pending callback.'
            : 'A lead has been reassigned to you.',
        link: `/company/sales/leads/${leadId}`,
        metadata: { leadId },
      });
    }

    if (previousHolderId && previousHolderId !== input.newOwnerId) {
      await notify(tx, ctx, {
        type: 'lead.reassigned',
        priority: 'operational',
        audience: { users: [previousHolderId] },
        title: 'Lead reassigned',
        body: `This lead has been reassigned. Reason: ${input.reason}`,
        link: `/company/sales/leads/${leadId}`,
        metadata: { leadId, newOwnerId: input.newOwnerId },
      });
    }

    const updated = await findLeadTx(tx, ctx.organizationId, leadId);
    if (!updated) throw new LeadNotFoundError();
    return { lead: updated, previousHolderId };
  });

  const recipients = new Set<string>([input.newOwnerId]);
  if (result.previousHolderId) recipients.add(result.previousHolderId);
  emitLeadReassigned(ctx.organizationId, [...recipients], {
    leadId,
    fromUserId: result.previousHolderId,
    toUserId: input.newOwnerId,
    reason: input.reason,
    reassignedAt: now.toISOString(),
    sourcingCreditTransferred: input.transferSourcingCredit,
  });

  return result.lead;
}
