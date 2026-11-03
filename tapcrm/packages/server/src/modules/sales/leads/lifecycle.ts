import type { RequestContext } from '../../../platform/dal/context.js';
import type { Tx } from '../../../platform/dal/db.js';
import { sql } from '../../../platform/dal/sql.js';
import { insertActivity, insertAudit } from './repository.js';

export function isTerminalLeadStatus(status: string): boolean {
  return status === 'converted' || status === 'closed_lost';
}

export type CallbackEnd = {
  readonly status: 'completed' | 'not_reachable' | 'missed' | 'cancelled';
  readonly outcome: string | null;
};

/**
 * Where a lead goes when its callback ends: a call that got through leaves it
 * contacted; no answer, a missed or a cancelled callback leaves it in
 * follow-up (PRD §4.4: "a no-answer lead stays in follow-up").
 */
export function statusAfterCallback(end: CallbackEnd): 'contacted' | 'follow_up' {
  if (end.status !== 'completed') return 'follow_up';
  return end.outcome === 'follow_up_required' || end.outcome === 'not_reachable'
    ? 'follow_up'
    : 'contacted';
}

/**
 * Moves a lead off "callback scheduled" once its callback has ended, so the
 * status shows what happened next. A lead that still has a pending callback,
 * or whose status someone already changed, is left alone.
 */
export async function settleLeadAfterCallbackInTransaction(
  tx: Tx,
  organizationId: string,
  leadId: string,
  end: CallbackEnd,
  actorId: string | null,
): Promise<string | null> {
  const next = statusAfterCallback(end);
  const moved = await tx.query<{ id: string }>(sql`
    UPDATE lead
       SET status = ${next}
     WHERE organization_id = ${organizationId}
       AND id              = ${leadId}
       AND status          = 'callback_scheduled'
       AND NOT EXISTS (
         SELECT 1
           FROM lead_callback c
          WHERE c.organization_id = lead.organization_id
            AND c.lead_id         = lead.id
            AND c.status          = 'pending'
       )
    RETURNING id
  `);
  if (moved.length === 0) return null;
  await insertActivity(tx, organizationId, leadId, 'lead.status_changed', actorId, {
    from: 'callback_scheduled',
    to: next,
    reason: `callback_${end.status}`,
  });
  return next;
}

/**
 * A converted or closed-lost Lead cannot have a callback, so its open one is
 * cancelled in the same transaction that closes the Lead. Otherwise it stays
 * in the owner's My Work, keeps sending reminders and is later marked missed.
 * Call this wherever a Lead becomes converted or closed-lost.
 */
export async function cancelOpenCallbacksInTransaction(
  tx: Tx,
  ctx: RequestContext,
  leadId: string,
  reason: 'lead_converted' | 'lead_closed_lost',
): Promise<number> {
  const cancelled = await tx.query<{ id: string }>(sql`
    UPDATE lead_callback
       SET status       = 'cancelled',
           cancelled_at = now(),
           updated_at   = now()
     WHERE organization_id = ${ctx.organizationId}
       AND lead_id         = ${leadId}
       AND status          = 'pending'
    RETURNING id
  `);
  for (const callback of cancelled) {
    await insertActivity(
      tx,
      ctx.organizationId,
      leadId,
      'callback.cancelled',
      ctx.principal.id,
      { callbackId: callback.id, reason },
    );
    await insertAudit(
      tx,
      ctx,
      'callback.cancelled',
      callback.id,
      { status: 'pending' },
      { status: 'cancelled', reason },
      'callback',
    );
  }
  return cancelled.length;
}

/**
 * Closes a Lead as lost, from a handover rejection or "Mark as lost".
 * Ownership is deliberately restored to the existing Lead owner; this is not
 * a reassignment operation. The outcome moves with the status so a lost lead
 * stops counting as active work.
 */
export async function closeLeadAsLostInTransaction(tx: Tx, organizationId: string, leadId: string, lossReason: string): Promise<boolean> {
  const rows = await tx.query<{ id: string }>(sql`
    UPDATE lead
    SET status = 'closed_lost', lead_outcome = 'closed_lost', loss_reason = ${lossReason}, lost_at = COALESCE(lost_at, now()), current_holder_id = owner_id
    WHERE organization_id = ${organizationId}
      AND id = ${leadId}
      AND status NOT IN ('converted', 'closed_lost')
    RETURNING id
  `);
  return rows.length > 0;
}
