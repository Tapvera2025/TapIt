import type { Resource } from '@tapcrm/authz';
import type { Principal } from '@tapcrm/contracts';
import { ApplicationError } from '../../errors.js';
import { createJobContext, systemPrincipal, type RequestContext } from '../../platform/dal/context.js';
import { db, type Tx } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import { emitToUser } from '../../platform/realtime/index.js';
import { attachmentsForScheduled, claimPendingAttachments, moveScheduledAttachments, releaseScheduledAttachments } from './attachments.js';
import { ChatNotFoundError, ChatNotSenderError, ChatValidationError } from './errors.js';
import { notifyScheduledFailed } from './notifications.js';
import { authorizedProjectMemberIds, conversationMemberIds, findConversationKindTx, findMessageRowTx } from './repository.js';
import { deliverMessage, unfurlInBackground } from './service.js';
import type { ScheduledMessage, ScheduledStatus } from './types.js';
import type { ScheduleMessageInput, UpdateScheduledInput } from './validators.js';

/**
 * Send later (0140). A scheduled message is a draft with a time; at that
 * time the `chat.scheduled-send` job delivers it AS ITS AUTHOR, in one
 * transaction with marking it sent. The author must still be an active
 * member of a live conversation then — otherwise it fails with a reason and
 * the author is notified, rather than appearing in a group they left.
 */

/** Earliest and latest a message may be scheduled for. */
const MIN_LEAD_MS = 30_000;
const MAX_LEAD_MS = 366 * 24 * 3_600_000;
/** A due message that keeps failing for unexpected reasons stops retrying after this long. */
const GIVE_UP_AFTER_MS = 60 * 60_000;

interface ScheduledRow {
  id: string;
  organizationId: string;
  conversationId: string;
  senderId: string;
  body: string;
  replyToMessageId: string | null;
  mentionedUserIds: string[];
  sendAt: Date;
  status: ScheduledStatus;
  sentMessageId: string | null;
  failureReason: string | null;
  createdAt: Date;
}

const COLUMNS = sql.raw(`
  id, organization_id, conversation_id, sender_id, body, reply_to_message_id, mentioned_user_ids,
  send_at, status, sent_message_id, failure_reason, created_at
`);

function assertSendAt(sendAt: Date, now: Date): void {
  if (Number.isNaN(sendAt.getTime())) throw new ChatValidationError('Choose a valid date and time');
  if (sendAt.getTime() < now.getTime() + MIN_LEAD_MS) throw new ChatValidationError('Choose a time at least a minute from now');
  if (sendAt.getTime() > now.getTime() + MAX_LEAD_MS) throw new ChatValidationError('Messages can be scheduled up to a year ahead');
}

async function toDtos(ctx: RequestContext, rows: readonly ScheduledRow[]): Promise<ScheduledMessage[]> {
  const files = await attachmentsForScheduled(ctx, rows.map((row) => row.id));
  return rows.map((row) => ({
    id: row.id,
    conversationId: row.conversationId,
    body: row.body,
    replyToMessageId: row.replyToMessageId,
    mentionedUserIds: row.mentionedUserIds,
    sendAt: row.sendAt,
    status: row.status,
    sentMessageId: row.sentMessageId,
    failureReason: row.failureReason,
    createdAt: row.createdAt,
    attachments: files.get(row.id) ?? [],
  }));
}

function tellSender(organizationId: string, senderId: string, row: Pick<ScheduledRow, 'id' | 'conversationId'>): void {
  emitToUser(organizationId, senderId, 'chat:scheduled:updated', { conversationId: row.conversationId, id: row.id });
}

/** For routes naming a SCHEDULED message — resolves to its conversation for the membership check. */
export async function loadScheduledResource(ctx: RequestContext, id: string): Promise<Resource | null> {
  if (ctx.principal.accountType === 'client') return null;
  const row = await db.maybeOne<{ conversationId: string }>(ctx, sql`
    SELECT conversation_id FROM scheduled_message WHERE organization_id = ${ctx.organizationId} AND id = ${id}
  `);
  if (!row) return null;
  const memberIds = await conversationMemberIds(ctx, row.conversationId);
  if (memberIds === null) return null;
  return { type: 'chatConversation', id: row.conversationId, organizationId: ctx.organizationId, memberIds };
}

export async function scheduleMessage(ctx: RequestContext, conversationId: string, input: ScheduleMessageInput, now: Date = new Date()): Promise<ScheduledMessage> {
  assertSendAt(input.sendAt, now);
  const row = await db.transaction(ctx, async (tx) => {
    const conversation = await tx.maybeOne<{ archivedAt: Date | null }>(sql`
      SELECT archived_at FROM conversation WHERE organization_id = ${ctx.organizationId} AND id = ${conversationId}
    `);
    if (!conversation) throw new ChatNotFoundError('conversation');
    if (conversation.archivedAt) throw new ChatValidationError('This conversation is archived');
    if (input.replyToMessageId) {
      const target = await findMessageRowTx(tx, ctx.organizationId, input.replyToMessageId);
      if (!target || target.conversationId !== conversationId) {
        throw new ChatValidationError('The message you are replying to is not in this conversation');
      }
    }
    const created = await tx.one<ScheduledRow>(sql`
      INSERT INTO scheduled_message (organization_id, conversation_id, sender_id, body, reply_to_message_id, mentioned_user_ids, send_at)
      VALUES (${ctx.organizationId}, ${conversationId}, ${ctx.principal.id}, ${input.body}, ${input.replyToMessageId ?? null},
              ${[...new Set(input.mentionedUserIds ?? [])]}::uuid[], ${input.sendAt})
      RETURNING ${COLUMNS}
    `);
    await claimPendingAttachments(tx, {
      organizationId: ctx.organizationId,
      conversationId,
      uploaderId: ctx.principal.id,
      attachmentIds: input.attachmentIds ?? [],
      target: { scheduledMessageId: created.id },
    });
    return created;
  });
  tellSender(ctx.organizationId, ctx.principal.id, row);
  const [dto] = await toDtos(ctx, [row]);
  return dto!;
}

/** My pending scheduled messages (optionally in one conversation), soonest first. */
export async function listScheduled(ctx: RequestContext, conversationId?: string): Promise<ScheduledMessage[]> {
  const rows = await db.query<ScheduledRow>(ctx, sql`
    SELECT ${COLUMNS} FROM scheduled_message s
    WHERE s.organization_id = ${ctx.organizationId} AND s.sender_id = ${ctx.principal.id} AND s.status = 'pending'
      AND (${conversationId ?? null}::uuid IS NULL OR s.conversation_id = ${conversationId ?? null}::uuid)
      AND EXISTS (
        SELECT 1 FROM conversation_member cm
        WHERE cm.organization_id = s.organization_id AND cm.conversation_id = s.conversation_id
          AND cm.user_id = ${ctx.principal.id} AND cm.left_at IS NULL
      )
    ORDER BY s.send_at, s.id
  `);
  return toDtos(ctx, rows);
}

async function lockOwnPending(tx: Tx, ctx: RequestContext, id: string): Promise<ScheduledRow> {
  const row = await tx.maybeOne<ScheduledRow>(sql`
    SELECT ${COLUMNS} FROM scheduled_message WHERE organization_id = ${ctx.organizationId} AND id = ${id} FOR UPDATE
  `);
  if (!row) throw new ChatNotFoundError('scheduled');
  if (row.senderId !== ctx.principal.id) throw new ChatNotSenderError();
  if (row.status !== 'pending') throw new ChatValidationError(`This message was already ${row.status === 'sent' ? 'sent' : row.status}`);
  return row;
}

export async function updateScheduled(ctx: RequestContext, id: string, input: UpdateScheduledInput, now: Date = new Date()): Promise<ScheduledMessage> {
  if (input.sendAt) assertSendAt(input.sendAt, now);
  const row = await db.transaction(ctx, async (tx) => {
    const current = await lockOwnPending(tx, ctx, id);
    if (input.body !== undefined && input.body.length === 0) {
      const files = await tx.maybeOne<{ id: string }>(sql`
        SELECT id FROM message_attachment WHERE organization_id = ${ctx.organizationId} AND scheduled_message_id = ${id} LIMIT 1
      `);
      if (!files) throw new ChatValidationError('Message cannot be empty');
    }
    return tx.one<ScheduledRow>(sql`
      UPDATE scheduled_message
         SET body = ${input.body ?? current.body},
             mentioned_user_ids = ${[...new Set(input.mentionedUserIds ?? current.mentionedUserIds)]}::uuid[],
             send_at = ${input.sendAt ?? current.sendAt}
       WHERE organization_id = ${ctx.organizationId} AND id = ${id}
      RETURNING ${COLUMNS}
    `);
  });
  tellSender(ctx.organizationId, ctx.principal.id, row);
  const [dto] = await toDtos(ctx, [row]);
  return dto!;
}

export async function cancelScheduled(ctx: RequestContext, id: string): Promise<{ cancelled: true }> {
  const row = await db.transaction(ctx, async (tx) => {
    const current = await lockOwnPending(tx, ctx, id);
    await tx.query(sql`UPDATE scheduled_message SET status = 'cancelled' WHERE organization_id = ${ctx.organizationId} AND id = ${id}`);
    await releaseScheduledAttachments(tx, ctx.organizationId, id);
    return current;
  });
  tellSender(ctx.organizationId, ctx.principal.id, row);
  return { cancelled: true };
}

/* ------------------------------------------------------------------ *
 * Delivery
 * ------------------------------------------------------------------ */

/** The author, as the actor of a job-delivered message (notifications exclude them; nothing is authorized with it). */
function authorPrincipal(organizationId: string, senderId: string): Principal {
  return {
    id: senderId,
    organizationId,
    sessionVersion: 0,
    accountType: 'service',
    allowedActions: [],
    allowedResources: [],
    expiresAt: new Date(0),
  };
}

type DeliveryOutcome =
  | { readonly kind: 'skipped' }
  | { readonly kind: 'sent'; readonly row: ScheduledRow; readonly messageId: string; readonly links: string[] }
  | { readonly kind: 'failed'; readonly row: ScheduledRow; readonly reason: string };

async function markFailed(ctx: RequestContext, row: ScheduledRow, reason: string): Promise<void> {
  await db.transaction(ctx, async (tx) => {
    const updated = await tx.query<{ id: string }>(sql`
      UPDATE scheduled_message SET status = 'failed', failure_reason = ${reason}
      WHERE organization_id = ${row.organizationId} AND id = ${row.id} AND status = 'pending'
      RETURNING id
    `);
    if (updated.length === 0) return;
    await releaseScheduledAttachments(tx, row.organizationId, row.id);
    const conversation = await findConversationKindTx(tx, row.organizationId, row.conversationId);
    // The system reports the failure: with the author as the actor, the
    // notification would exclude the one person it is for.
    await notifyScheduledFailed(tx, { organizationId: row.organizationId, principal: systemPrincipal(row.organizationId) }, {
      senderId: row.senderId,
      conversationId: row.conversationId,
      conversationName: conversation?.name ?? null,
      reason,
    });
  });
}

/**
 * Delivers one scheduled message if it is still pending. Claim, insert and
 * mark-sent share one transaction, and the claim is `FOR UPDATE SKIP
 * LOCKED`: two workers (or the job and "Send now") can never both send it.
 */
async function deliverScheduled(organizationId: string, id: string, options: { requireDue: boolean; now: Date }): Promise<DeliveryOutcome> {
  const lookup = createJobContext({ organizationId, principal: authorPrincipal(organizationId, '00000000-0000-0000-0000-000000000000'), jobName: 'chat.scheduled-send', runId: id });
  const head = await db.maybeOne<ScheduledRow>(lookup, sql`SELECT ${COLUMNS} FROM scheduled_message WHERE organization_id = ${organizationId} AND id = ${id}`);
  if (!head || head.status !== 'pending') return { kind: 'skipped' };
  const ctx = createJobContext({ organizationId, principal: authorPrincipal(organizationId, head.senderId), jobName: 'chat.scheduled-send', runId: id });

  // Membership is judged as of NOW, the same rule a live send passes (project
  // conversations also require the live project/client relationship).
  const allowed = await authorizedProjectMemberIds(ctx, head.conversationId);
  const archived = await db.maybeOne<{ archivedAt: Date | null }>(ctx, sql`
    SELECT archived_at FROM conversation WHERE organization_id = ${organizationId} AND id = ${head.conversationId}
  `);
  const refusal = !allowed || !archived
    ? 'The conversation no longer exists.'
    : archived.archivedAt
      ? 'The conversation was archived before the message was due.'
      : !allowed.includes(head.senderId)
        ? 'You were no longer a member of the conversation when the message was due.'
        : null;
  if (refusal) {
    await markFailed(ctx, head, refusal);
    return { kind: 'failed', row: head, reason: refusal };
  }

  try {
    return await db.transaction(ctx, async (tx): Promise<DeliveryOutcome> => {
      const row = await tx.maybeOne<ScheduledRow>(sql`
        SELECT ${COLUMNS} FROM scheduled_message
        WHERE organization_id = ${organizationId} AND id = ${id} AND status = 'pending'
          AND (${!options.requireDue}::boolean OR send_at <= ${options.now})
        FOR UPDATE SKIP LOCKED
      `);
      if (!row) return { kind: 'skipped' };
      const sent = await deliverMessage(tx, ctx, row.senderId, row.conversationId, {
        body: row.body,
        replyToMessageId: row.replyToMessageId,
        mentionedUserIds: row.mentionedUserIds,
      }, { claimAttachments: false });
      await moveScheduledAttachments(tx, organizationId, row.id, sent.id);
      const hasContent = row.body.length > 0 || (await tx.maybeOne<{ id: string }>(sql`
        SELECT id FROM message_attachment WHERE organization_id = ${organizationId} AND message_id = ${sent.id} LIMIT 1
      `)) !== null;
      if (!hasContent) throw new ChatValidationError('The message had no text and its files are no longer available.');
      await tx.query(sql`
        UPDATE scheduled_message SET status = 'sent', sent_message_id = ${sent.id}, sent_at = now()
        WHERE organization_id = ${organizationId} AND id = ${row.id}
      `);
      return { kind: 'sent', row, messageId: sent.id, links: sent.links };
    });
  } catch (error) {
    const overdue = options.now.getTime() - head.sendAt.getTime() > GIVE_UP_AFTER_MS;
    if (error instanceof ApplicationError || overdue) {
      const reason = error instanceof ApplicationError ? error.message : 'It could not be delivered. Please send it again.';
      await markFailed(ctx, head, reason);
      return { kind: 'failed', row: head, reason };
    }
    throw error; // transient (database restart, deadlock exhausted): the next sweep retries it
  }
}

async function announce(organizationId: string, outcome: DeliveryOutcome): Promise<void> {
  if (outcome.kind === 'skipped') return;
  tellSender(organizationId, outcome.row.senderId, outcome.row);
  if (outcome.kind !== 'sent') return;
  const ctx = createJobContext({ organizationId, principal: authorPrincipal(organizationId, outcome.row.senderId), jobName: 'chat.scheduled-send', runId: outcome.row.id });
  // Everyone, the author included: their own client did not send this one.
  const memberIds = await authorizedProjectMemberIds(ctx, outcome.row.conversationId);
  for (const memberId of memberIds ?? []) {
    emitToUser(organizationId, memberId, 'chat:message:new', { conversationId: outcome.row.conversationId, id: outcome.messageId });
  }
  unfurlInBackground(organizationId, outcome.row.conversationId, outcome.messageId, outcome.links);
}

/** "Send now" from the scheduled list. */
export async function sendScheduledNow(ctx: RequestContext, id: string): Promise<{ sent: boolean; messageId: string | null; failureReason: string | null }> {
  const row = await db.maybeOne<{ senderId: string; status: ScheduledStatus }>(ctx, sql`
    SELECT sender_id, status FROM scheduled_message WHERE organization_id = ${ctx.organizationId} AND id = ${id}
  `);
  if (!row) throw new ChatNotFoundError('scheduled');
  if (row.senderId !== ctx.principal.id) throw new ChatNotSenderError();
  if (row.status !== 'pending') throw new ChatValidationError(`This message was already ${row.status}`);
  const outcome = await deliverScheduled(ctx.organizationId, id, { requireDue: false, now: new Date() });
  await announce(ctx.organizationId, outcome);
  return {
    sent: outcome.kind === 'sent',
    messageId: outcome.kind === 'sent' ? outcome.messageId : null,
    failureReason: outcome.kind === 'failed' ? outcome.reason : null,
  };
}

/** The job: every due message of one organization, oldest first. */
export async function sendDueScheduledMessages(ctx: RequestContext, now: Date, limit = 200): Promise<number> {
  const due = await db.query<{ id: string }>(ctx, sql`
    SELECT id FROM scheduled_message
    WHERE organization_id = ${ctx.organizationId} AND status = 'pending' AND send_at <= ${now}
    ORDER BY send_at, id
    LIMIT ${limit}
  `);
  let processed = 0;
  for (const { id } of due) {
    try {
      const outcome = await deliverScheduled(ctx.organizationId, id, { requireDue: true, now });
      await announce(ctx.organizationId, outcome);
      if (outcome.kind !== 'skipped') processed += 1;
    } catch (error) {
      console.error(JSON.stringify({ level: 'warn', msg: 'scheduled chat message not sent yet', scheduledMessageId: id, error: String(error) }));
    }
  }
  return processed;
}
