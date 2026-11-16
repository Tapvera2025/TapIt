import type { PresenceState } from '@tapcrm/contracts';
import { createJobContext, systemPrincipal, type RequestContext } from '../../platform/dal/context.js';
import { db, type Tx } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import type { OutboxEvent } from '../../platform/outbox/registry.js';
import { readRow } from '../live-status/facade.js';
import { ChatNotFoundError, ChatValidationError } from './errors.js';
import { notifyBreakReturn } from './notifications.js';
import { conversationMemberIdsTx, findConversationKindTx, findUserFullName } from './repository.js';

/**
 * "Tell me when they're back" (0159).
 *
 * In a direct message with someone who is on a break, the chat shows a strip
 * above the message box with this button. Pressing it stores a request; when
 * that person's attendance status changes, `deliverBreakReturns` reads their
 * status again and, once the break is over, tells everyone who asked.
 *
 * Only the coarse state is used, the same one behind the orange dot: on a
 * break or not. No break times leave the live-status module.
 */

/**
 * How long a request stays live. A break does not last this long, so an
 * older request is about a break that ended without another status change
 * (the day closed some other way). It is dropped quietly rather than answered
 * with a "back from break" that would no longer be true.
 */
const REQUEST_LIFETIME_HOURS = 12;

export interface BreakReturnWatch {
  readonly watching: boolean;
}

/** Once a break is over: back at work, or not at work at all (punched out, the day ended). */
export type BreakOutcome = 'back' | 'away';

/**
 * Where a person stands for the waiting colleagues. `null` means they are
 * still on a break, so nobody is told anything yet. No status at all counts
 * as away.
 */
export function breakOutcome(state: PresenceState | null): BreakOutcome | null {
  if (state === 'ON_BREAK') return null;
  return state === 'WORKING' ? 'back' : 'away';
}

/** The other person in a direct message. Anything else has no one person to wait for. */
async function directSubject(tx: Tx, ctx: RequestContext, conversationId: string): Promise<string> {
  const conversation = await findConversationKindTx(tx, ctx.organizationId, conversationId);
  if (!conversation) throw new ChatNotFoundError();
  if (conversation.kind !== 'direct') throw new ChatValidationError('This is only available in a direct message');
  const others = (await conversationMemberIdsTx(tx, ctx.organizationId, conversationId)).filter((id) => id !== ctx.principal.id);
  if (others.length !== 1) throw new ChatValidationError('There is no one else in this conversation');
  return others[0]!;
}

/** Whether the caller has asked to be told when the other person in this conversation is back. */
export async function getBreakReturnWatch(ctx: RequestContext, conversationId: string): Promise<BreakReturnWatch> {
  const row = await db.maybeOne<{ watching: boolean }>(ctx, sql`
    SELECT true AS watching
      FROM chat_break_return_watch
     WHERE organization_id = ${ctx.organizationId}
       AND conversation_id = ${conversationId}
       AND watcher_id = ${ctx.principal.id}
       AND created_at > now() - make_interval(hours => ${REQUEST_LIFETIME_HOURS}::int)
  `);
  return { watching: row !== null };
}

/**
 * Ask to be told when the other person is back. Refused when they are not on
 * a break now (their dot was out of date): there is nothing to wait for.
 * Asking twice keeps one request.
 */
export async function watchBreakReturn(ctx: RequestContext, conversationId: string): Promise<BreakReturnWatch> {
  return db.transaction(ctx, async (tx) => {
    const subjectId = await directSubject(tx, ctx, conversationId);
    const status = await readRow(tx, subjectId);
    if (status?.state !== 'ON_BREAK') {
      const name = await findUserFullName(tx, ctx.organizationId, subjectId);
      throw new ChatValidationError(`${name} isn't on a break right now`);
    }
    // The caller's own expired requests go first, so the table stays small.
    await tx.query(sql`
      DELETE FROM chat_break_return_watch
       WHERE organization_id = ${ctx.organizationId}
         AND watcher_id = ${ctx.principal.id}
         AND created_at <= now() - make_interval(hours => ${REQUEST_LIFETIME_HOURS}::int)
    `);
    await tx.query(sql`
      INSERT INTO chat_break_return_watch (organization_id, watcher_id, subject_id, conversation_id)
      VALUES (${ctx.organizationId}, ${ctx.principal.id}, ${subjectId}, ${conversationId})
      ON CONFLICT (organization_id, watcher_id, subject_id)
      DO UPDATE SET conversation_id = EXCLUDED.conversation_id, created_at = now()
    `);
    return { watching: true };
  });
}

/** Changed your mind: no notification. Cancelling a request that is already gone is fine. */
export async function cancelBreakReturnWatch(ctx: RequestContext, conversationId: string): Promise<BreakReturnWatch> {
  await db.transaction(ctx, (tx) => tx.query(sql`
    DELETE FROM chat_break_return_watch
     WHERE organization_id = ${ctx.organizationId}
       AND conversation_id = ${conversationId}
       AND watcher_id = ${ctx.principal.id}
  `));
  return { watching: false };
}

/**
 * live-status → chat: someone's attendance status changed. If their break is
 * over, everyone who asked is told, and the requests are removed.
 *
 * Idempotent: the requests are locked and deleted in the same transaction
 * that queues the notifications, so a repeated delivery of the same event
 * finds nothing left to answer.
 */
export async function deliverBreakReturns(event: OutboxEvent): Promise<void> {
  const userId = (event.payload as { userId?: unknown } | null)?.userId;
  if (typeof userId !== 'string') return;
  const ctx = createJobContext({
    organizationId: event.organizationId,
    principal: systemPrincipal(event.organizationId),
    jobName: 'chat.break-return',
    runId: event.id,
  });
  await db.transaction(ctx, async (tx) => {
    const requests = await tx.query<{ watcherId: string; conversationId: string; live: boolean }>(sql`
      SELECT watcher_id, conversation_id,
             created_at > now() - make_interval(hours => ${REQUEST_LIFETIME_HOURS}::int) AS live
        FROM chat_break_return_watch
       WHERE organization_id = ${event.organizationId} AND subject_id = ${userId}
       FOR UPDATE
    `);
    if (requests.length === 0) return;

    const status = await readRow(tx, userId);
    const outcome = breakOutcome(status?.state ?? null);
    if (outcome === null) return; // still on a break: keep waiting

    await tx.query(sql`
      DELETE FROM chat_break_return_watch
       WHERE organization_id = ${event.organizationId} AND subject_id = ${userId}
    `);
    const live = requests.filter((request) => request.live);
    if (live.length === 0) return;

    const subjectName = await findUserFullName(tx, event.organizationId, userId);
    for (const request of live) {
      await notifyBreakReturn(tx, ctx, {
        watcherId: request.watcherId,
        conversationId: request.conversationId,
        subjectId: userId,
        subjectName,
        outcome,
      });
    }
  });
}
