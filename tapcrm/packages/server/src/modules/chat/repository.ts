import type { RequestContext } from '../../platform/dal/context.js';
import { db, type Tx } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import type {
  Conversation,
  ConversationKind,
  ConversationMember,
  Message,
  MessagePreview,
  MessageReaction,
} from './types.js';

/* ------------------------------------------------------------------ *
 * Rows — snake_case columns come back camelCased through the DAL
 * (packages/server/src/platform/dal/mapping.ts); these interfaces name the
 * shape after that conversion, not the SQL text.
 * ------------------------------------------------------------------ */

interface ConversationRow {
  id: string;
  organizationId: string;
  kind: ConversationKind;
  name: string | null;
  projectId: string | null;
  createdBy: string;
  createdAt: Date;
}

interface MemberRow {
  conversationId: string;
  userId: string;
  fullName: string;
  lastReadAt: Date | null;
}

interface MessageRow {
  id: string;
  organizationId: string;
  conversationId: string;
  senderId: string;
  body: string | null;
  replyToMessageId: string | null;
  forwarded: boolean;
  forwardedFromSenderId: string | null;
  deletedAt: Date | null;
  createdAt: Date;
}

/** `organizationId::userId1::userId2` sorted lexically — the DM de-duplication key. */
export function directPairKey(userIdA: string, userIdB: string): string {
  return [userIdA, userIdB].sort().join(':');
}

/** The ids of every current (not left) member — what `loadResource` needs for the policy check. */
export async function conversationMemberIds(ctx: RequestContext, conversationId: string): Promise<string[] | null> {
  const conversation = await db.maybeOne<{ id: string }>(ctx, sql`
    SELECT id FROM conversation WHERE organization_id = ${ctx.organizationId} AND id = ${conversationId}
  `);
  if (!conversation) return null;
  const rows = await db.query<{ userId: string }>(ctx, sql`
    SELECT user_id FROM conversation_member
    WHERE organization_id = ${ctx.organizationId} AND conversation_id = ${conversationId} AND left_at IS NULL
  `);
  return rows.map((r) => r.userId);
}

async function membersFor(ctx: RequestContext, conversationIds: readonly string[]): Promise<Map<string, ConversationMember[]>> {
  if (conversationIds.length === 0) return new Map();
  const rows = await db.query<MemberRow>(ctx, sql`
    SELECT cm.conversation_id, cm.user_id, cm.last_read_at, u.full_name
    FROM conversation_member cm
    JOIN app_user u ON u.organization_id = cm.organization_id AND u.id = cm.user_id
    WHERE cm.organization_id = ${ctx.organizationId}
      AND cm.conversation_id = ANY(${[...conversationIds]}::uuid[])
      AND cm.left_at IS NULL
    ORDER BY u.full_name
  `);
  const byConversation = new Map<string, ConversationMember[]>();
  for (const row of rows) {
    const list = byConversation.get(row.conversationId) ?? [];
    list.push({ userId: row.userId, fullName: row.fullName, lastReadAt: row.lastReadAt });
    byConversation.set(row.conversationId, list);
  }
  return byConversation;
}

async function lastMessagesFor(ctx: RequestContext, conversationIds: readonly string[]): Promise<Map<string, MessagePreview>> {
  if (conversationIds.length === 0) return new Map();
  // DISTINCT ON: the single newest row per conversation, in one query.
  const rows = await db.query<MessagePreview & { conversationId: string }>(ctx, sql`
    SELECT DISTINCT ON (conversation_id) conversation_id AS "conversationId",
           id, sender_id AS "senderId", body, deleted_at AS "deletedAt", created_at AS "createdAt"
    FROM message
    WHERE organization_id = ${ctx.organizationId} AND conversation_id = ANY(${[...conversationIds]}::uuid[])
    ORDER BY conversation_id, created_at DESC, id DESC
  `);
  return new Map(rows.map((r) => [r.conversationId, r]));
}

/** Unread = messages after MY read cursor, not sent by me. Zero if I have never opened it. */
async function unreadCountsFor(ctx: RequestContext, conversationIds: readonly string[]): Promise<Map<string, number>> {
  if (conversationIds.length === 0) return new Map();
  const rows = await db.query<{ conversationId: string; count: string }>(ctx, sql`
    SELECT m.conversation_id AS "conversationId", count(*)::text AS count
    FROM message m
    JOIN conversation_member cm
      ON cm.organization_id = m.organization_id AND cm.conversation_id = m.conversation_id AND cm.user_id = ${ctx.principal.id}
    WHERE m.organization_id = ${ctx.organizationId}
      AND m.conversation_id = ANY(${[...conversationIds]}::uuid[])
      AND m.sender_id <> ${ctx.principal.id}
      AND (cm.last_read_at IS NULL OR m.created_at > cm.last_read_at)
    GROUP BY m.conversation_id
  `);
  return new Map(rows.map((r) => [r.conversationId, Number(r.count)]));
}

function toConversation(
  row: ConversationRow,
  members: Map<string, ConversationMember[]>,
  lastMessages: Map<string, MessagePreview>,
  unread: Map<string, number>,
): Conversation {
  return {
    id: row.id,
    organizationId: row.organizationId,
    kind: row.kind,
    name: row.name,
    projectId: row.projectId,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    members: members.get(row.id) ?? [],
    lastMessage: lastMessages.get(row.id) ?? null,
    unreadCount: unread.get(row.id) ?? 0,
  };
}

/** My conversations, newest activity first. `kind` narrows to one tab (e.g. 'direct'). */
export async function listConversationsForUser(ctx: RequestContext, kind?: ConversationKind): Promise<Conversation[]> {
  const rows = await db.query<ConversationRow & { lastActivityAt: Date }>(ctx, sql`
    SELECT c.id, c.organization_id, c.kind, c.name, c.project_id, c.created_by, c.created_at,
           GREATEST(c.created_at, COALESCE((
             SELECT max(m.created_at) FROM message m
             WHERE m.organization_id = c.organization_id AND m.conversation_id = c.id
           ), c.created_at)) AS "lastActivityAt"
    FROM conversation c
    WHERE c.organization_id = ${ctx.organizationId}
      AND c.archived_at IS NULL
      AND (${kind ?? null}::text IS NULL OR c.kind = ${kind ?? null})
      AND EXISTS (
        SELECT 1 FROM conversation_member cm
        WHERE cm.organization_id = c.organization_id AND cm.conversation_id = c.id
          AND cm.user_id = ${ctx.principal.id} AND cm.left_at IS NULL
      )
    ORDER BY "lastActivityAt" DESC
  `);
  const ids = rows.map((r) => r.id);
  const [members, lastMessages, unread] = await Promise.all([membersFor(ctx, ids), lastMessagesFor(ctx, ids), unreadCountsFor(ctx, ids)]);
  return rows.map((row) => toConversation(row, members, lastMessages, unread));
}

export async function findConversationById(ctx: RequestContext, id: string): Promise<Conversation | null> {
  const row = await db.maybeOne<ConversationRow>(ctx, sql`
    SELECT id, organization_id, kind, name, project_id, created_by, created_at
    FROM conversation WHERE organization_id = ${ctx.organizationId} AND id = ${id}
  `);
  if (!row) return null;
  const [members, lastMessages, unread] = await Promise.all([
    membersFor(ctx, [id]),
    lastMessagesFor(ctx, [id]),
    unreadCountsFor(ctx, [id]),
  ]);
  return toConversation(row, members, lastMessages, unread);
}

/** Reuses the existing DM if one already exists between these two people (unique index on the pair key). */
export async function findOrCreateDirectConversation(tx: Tx, ctx: RequestContext, otherUserId: string): Promise<{ id: string; created: boolean }> {
  const pairKey = directPairKey(ctx.principal.id, otherUserId);
  const existing = await tx.maybeOne<{ id: string }>(sql`
    SELECT id FROM conversation WHERE organization_id = ${ctx.organizationId} AND kind = 'direct' AND direct_pair_key = ${pairKey}
  `);
  if (existing) return { id: existing.id, created: false };

  const created = await tx.one<{ id: string }>(sql`
    INSERT INTO conversation (organization_id, kind, direct_pair_key, created_by)
    VALUES (${ctx.organizationId}, 'direct', ${pairKey}, ${ctx.principal.id})
    RETURNING id
  `);
  await tx.query(sql`
    INSERT INTO conversation_member (conversation_id, organization_id, user_id)
    VALUES (${created.id}, ${ctx.organizationId}, ${ctx.principal.id}), (${created.id}, ${ctx.organizationId}, ${otherUserId})
  `);
  return { id: created.id, created: true };
}

/**
 * A named, multi-member conversation — 'group' (Phase 3, Super-Admin-only via
 * the route) or 'project' (Phase 4, created by the facade with a caller-
 * chosen membership, e.g. a project's assigned employees + client).
 */
export async function createGroupConversation(
  tx: Tx,
  organizationId: string,
  createdBy: string,
  input: { kind: 'group' | 'project'; name: string; memberIds: readonly string[]; projectId?: string | null },
): Promise<{ id: string }> {
  const created = await tx.one<{ id: string }>(sql`
    INSERT INTO conversation (organization_id, kind, name, project_id, created_by)
    VALUES (${organizationId}, ${input.kind}, ${input.name}, ${input.projectId ?? null}, ${createdBy})
    RETURNING id
  `);
  const memberIds = [...new Set([createdBy, ...input.memberIds])];
  await tx.query(sql`
    INSERT INTO conversation_member (conversation_id, organization_id, user_id)
    SELECT ${created.id}, ${organizationId}, u FROM unnest(${memberIds}::uuid[]) AS u
  `);
  return created;
}

/** Every id, active-status or not, is checked at the call site (a departed employee cannot be added). */
export async function validateMemberIds(tx: Tx, organizationId: string, userIds: readonly string[]): Promise<string[]> {
  if (userIds.length === 0) return [];
  const rows = await tx.query<{ id: string }>(sql`
    SELECT id FROM app_user
    WHERE organization_id = ${organizationId} AND id = ANY(${[...userIds]}::uuid[])
      AND status = 'active' AND account_type <> 'service'
  `);
  return rows.map((r) => r.id);
}

/** `kind` and `name`/`projectId` only, never `direct_pair_key` (dedup is direct-only, CH-1). */
export async function findConversationKind(ctx: RequestContext, id: string): Promise<{ kind: ConversationKind; name: string | null } | null> {
  return db.maybeOne<{ kind: ConversationKind; name: string | null }>(ctx, sql`
    SELECT kind, name FROM conversation WHERE organization_id = ${ctx.organizationId} AND id = ${id}
  `);
}

export async function renameConversation(tx: Tx, organizationId: string, id: string, name: string): Promise<void> {
  await tx.query(sql`
    UPDATE conversation SET name = ${name}, updated_at = now() WHERE organization_id = ${organizationId} AND id = ${id}
  `);
}

/**
 * Re-adds a member. `left_at = NULL` rather than a fresh row: if they were
 * removed earlier, re-adding them is a rejoin, not a second membership row
 * (the primary key is (conversation_id, user_id)).
 */
export async function addConversationMembers(tx: Tx, organizationId: string, conversationId: string, userIds: readonly string[]): Promise<void> {
  if (userIds.length === 0) return;
  await tx.query(sql`
    INSERT INTO conversation_member (conversation_id, organization_id, user_id)
    SELECT ${conversationId}, ${organizationId}, u FROM unnest(${[...userIds]}::uuid[]) AS u
    ON CONFLICT (conversation_id, user_id) DO UPDATE SET left_at = NULL
  `);
}

/** Soft-remove: the row (and the history they were part of) stays; `left_at` is what `filter()`/listing checks. */
export async function removeConversationMember(tx: Tx, organizationId: string, conversationId: string, userId: string): Promise<void> {
  await tx.query(sql`
    UPDATE conversation_member SET left_at = now()
    WHERE organization_id = ${organizationId} AND conversation_id = ${conversationId} AND user_id = ${userId} AND left_at IS NULL
  `);
}

export async function archiveConversation(tx: Tx, organizationId: string, id: string): Promise<void> {
  await tx.query(sql`
    UPDATE conversation SET archived_at = now() WHERE organization_id = ${organizationId} AND id = ${id}
  `);
}

/* ---------------------------------- messages --------------------------------- */

export function encodeMessageCursor(row: { createdAt: string; id: string }): string {
  return Buffer.from(JSON.stringify([row.createdAt, row.id])).toString('base64url');
}

export function decodeMessageCursor(cursor: string): { createdAt: Date; id: string } | null {
  try {
    const [createdAt, id] = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as [string, string];
    const date = new Date(createdAt);
    if (Number.isNaN(date.getTime()) || typeof id !== 'string') return null;
    return { createdAt: date, id };
  } catch {
    return null;
  }
}

async function attachDerived(ctx: RequestContext, conversationId: string, rows: MessageRow[]): Promise<Message[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);

  const [reactionRows, membersByConversation, replyRows] = await Promise.all([
    db.query<{ messageId: string } & MessageReaction>(ctx, sql`
      SELECT message_id AS "messageId", user_id AS "userId", emoji FROM message_reaction
      WHERE organization_id = ${ctx.organizationId} AND message_id = ANY(${ids}::uuid[])
    `),
    membersFor(ctx, [conversationId]),
    (async () => {
      const replyIds = [...new Set(rows.map((r) => r.replyToMessageId).filter((id): id is string => id !== null))];
      if (replyIds.length === 0) return new Map<string, MessagePreview>();
      const previews = await db.query<MessagePreview>(ctx, sql`
        SELECT id, sender_id AS "senderId", body, deleted_at AS "deletedAt", created_at AS "createdAt"
        FROM message WHERE organization_id = ${ctx.organizationId} AND id = ANY(${replyIds}::uuid[])
      `);
      return new Map(previews.map((p) => [p.id, p]));
    })(),
  ]);
  const members = membersByConversation.get(conversationId) ?? [];

  const reactionsByMessage = new Map<string, MessageReaction[]>();
  for (const r of reactionRows) {
    const list = reactionsByMessage.get(r.messageId) ?? [];
    list.push({ userId: r.userId, emoji: r.emoji });
    reactionsByMessage.set(r.messageId, list);
  }

  return rows.map((row) => ({
    id: row.id,
    organizationId: row.organizationId,
    conversationId: row.conversationId,
    senderId: row.senderId,
    body: row.body,
    replyToMessageId: row.replyToMessageId,
    replyPreview: row.replyToMessageId ? (replyRows.get(row.replyToMessageId) ?? null) : null,
    forwarded: row.forwarded,
    forwardedFromSenderId: row.forwardedFromSenderId,
    deletedAt: row.deletedAt,
    createdAt: row.createdAt,
    reactions: reactionsByMessage.get(row.id) ?? [],
    // "Seen by": other members whose read cursor has reached this message.
    seenBy: members.filter((m) => m.userId !== row.senderId && m.lastReadAt !== null && m.lastReadAt >= row.createdAt).map((m) => m.userId),
  }));
}

export async function listMessages(
  ctx: RequestContext,
  conversationId: string,
  options: { limit: number; cursor: { createdAt: Date; id: string } | null },
): Promise<Message[]> {
  const cursorAt = options.cursor?.createdAt ?? null;
  const cursorId = options.cursor?.id ?? null;
  const rows = await db.query<MessageRow>(ctx, sql`
    SELECT id, organization_id, conversation_id, sender_id, body, reply_to_message_id, forwarded, forwarded_from_sender_id, deleted_at, created_at
    FROM message
    WHERE organization_id = ${ctx.organizationId} AND conversation_id = ${conversationId}
      AND (${cursorAt}::timestamptz IS NULL OR (created_at, id) < (${cursorAt}::timestamptz, ${cursorId}::uuid))
    ORDER BY created_at DESC, id DESC
    LIMIT ${options.limit}
  `);
  return attachDerived(ctx, conversationId, rows);
}

export async function findMessageById(ctx: RequestContext, id: string): Promise<Message | null> {
  const row = await db.maybeOne<MessageRow>(ctx, sql`
    SELECT id, organization_id, conversation_id, sender_id, body, reply_to_message_id, forwarded, forwarded_from_sender_id, deleted_at, created_at
    FROM message WHERE organization_id = ${ctx.organizationId} AND id = ${id}
  `);
  if (!row) return null;
  const [message] = await attachDerived(ctx, row.conversationId, [row]);
  return message ?? null;
}

export async function insertMessage(
  tx: Tx,
  organizationId: string,
  senderId: string,
  conversationId: string,
  input: { body: string; replyToMessageId?: string | null; forwarded?: boolean; forwardedFromSenderId?: string | null },
): Promise<{ id: string; createdAt: Date }> {
  return tx.one<{ id: string; createdAt: Date }>(sql`
    INSERT INTO message (organization_id, conversation_id, sender_id, body, reply_to_message_id, forwarded, forwarded_from_sender_id)
    VALUES (${organizationId}, ${conversationId}, ${senderId}, ${input.body}, ${input.replyToMessageId ?? null},
            ${input.forwarded ?? false}, ${input.forwardedFromSenderId ?? null})
    RETURNING id, created_at AS "createdAt"
  `);
}

export async function unsendMessage(tx: Tx, organizationId: string, id: string, deletedBy: string): Promise<void> {
  await tx.query(sql`
    UPDATE message SET body = NULL, deleted_at = now(), deleted_by = ${deletedBy}
    WHERE organization_id = ${organizationId} AND id = ${id}
  `);
}

export async function addReaction(tx: Tx, organizationId: string, messageId: string, userId: string, emoji: string): Promise<void> {
  await tx.query(sql`
    INSERT INTO message_reaction (message_id, organization_id, user_id, emoji)
    VALUES (${messageId}, ${organizationId}, ${userId}, ${emoji})
    ON CONFLICT (message_id, user_id, emoji) DO NOTHING
  `);
}

export async function removeReaction(tx: Tx, organizationId: string, messageId: string, userId: string, emoji: string): Promise<void> {
  await tx.query(sql`
    DELETE FROM message_reaction
    WHERE organization_id = ${organizationId} AND message_id = ${messageId} AND user_id = ${userId} AND emoji = ${emoji}
  `);
}

export async function markConversationRead(tx: Tx, organizationId: string, conversationId: string, userId: string): Promise<void> {
  await tx.query(sql`
    UPDATE conversation_member SET last_read_at = now()
    WHERE organization_id = ${organizationId} AND conversation_id = ${conversationId} AND user_id = ${userId}
  `);
}
