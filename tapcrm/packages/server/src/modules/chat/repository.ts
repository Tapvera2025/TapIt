import type { RequestContext } from '../../platform/dal/context.js';
import { db, type Tx } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import { attachmentsForMessages } from './attachments.js';
import { previewsForMessages } from './link-preview.js';
import type {
  AttachmentKind,
  Conversation,
  ConversationKind,
  ConversationMember,
  Message,
  MessageEdit,
  MessageMention,
  MessagePreview,
  MessageReaction,
  ChatUnreadSummary,
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
  description: string | null;
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
  editedAt: Date | null;
}

/** The core columns of a message row, for every read below. */
const MESSAGE_COLUMNS = sql.raw(
  'id, organization_id, conversation_id, sender_id, body, reply_to_message_id, forwarded, forwarded_from_sender_id, deleted_at, created_at, edited_at',
);

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

/** Active project members, filtering client accounts through the live project/client relationship. */
export async function authorizedProjectMemberIds(ctx: RequestContext, conversationId: string): Promise<string[] | null> {
  const kind = await db.maybeOne<{ kind: ConversationKind }>(ctx, sql`
    SELECT kind FROM conversation WHERE organization_id = ${ctx.organizationId} AND id = ${conversationId}
  `);
  if (!kind) return null;
  if (kind.kind !== 'project') {
    const employees = await db.query<{ userId: string }>(ctx, sql`
      SELECT cm.user_id FROM conversation_member cm
      JOIN app_user u ON u.organization_id = cm.organization_id AND u.id = cm.user_id
      WHERE cm.organization_id = ${ctx.organizationId} AND cm.conversation_id = ${conversationId}
        AND cm.left_at IS NULL AND u.status = 'active' AND u.account_type IN ('employee', 'super-admin')
    `);
    return employees.map((row) => row.userId);
  }
  const rows = await db.query<{ userId: string }>(ctx, sql`
    SELECT cm.user_id
    FROM conversation c
    JOIN project p ON p.organization_id = c.organization_id AND p.id = c.project_id AND p.archived_at IS NULL
    JOIN client cl ON cl.organization_id = p.organization_id AND cl.id = p.client_id AND cl.status = 'active'
    JOIN conversation_member cm ON cm.organization_id = c.organization_id AND cm.conversation_id = c.id AND cm.left_at IS NULL
    JOIN app_user u ON u.organization_id = cm.organization_id AND u.id = cm.user_id AND u.status = 'active'
    WHERE c.organization_id = ${ctx.organizationId} AND c.id = ${conversationId}
      AND c.kind = 'project' AND c.archived_at IS NULL
      AND (u.account_type <> 'client' OR u.client_id = p.client_id)
  `);
  const exists = await db.maybeOne<{ id: string }>(ctx, sql`
    SELECT id FROM conversation WHERE organization_id = ${ctx.organizationId} AND id = ${conversationId}
  `);
  return exists ? rows.map((row) => row.userId) : null;
}

/** Same lookup, participating in a caller's open transaction — for notifying inside the same commit as the write (TX-2). */
export async function conversationMemberIdsTx(tx: Tx, organizationId: string, conversationId: string): Promise<string[]> {
  const rows = await tx.query<{ userId: string }>(sql`
    SELECT user_id FROM conversation_member
    WHERE organization_id = ${organizationId} AND conversation_id = ${conversationId} AND left_at IS NULL
  `);
  return rows.map((r) => r.userId);
}

export async function findUserFullName(tx: Tx, organizationId: string, userId: string): Promise<string> {
  const row = await tx.maybeOne<{ fullName: string }>(sql`
    SELECT full_name AS "fullName" FROM app_user WHERE organization_id = ${organizationId} AND id = ${userId}
  `);
  return row?.fullName ?? 'Someone';
}

/**
 * Everyone in the org a Direct Message could be started with. Deliberately
 * not the HR employee directory (`users:view`, all-people only) — DM is
 * peer-to-peer and `chat:send` is granted to every employee position
 * (CH-1), so the picker must not be narrower than that.
 */
export async function listColleagues(ctx: RequestContext, excludeUserId: string): Promise<{ id: string; fullName: string }[]> {
  return db.query<{ id: string; fullName: string }>(ctx, sql`
    SELECT id, full_name AS "fullName"
    FROM app_user
    WHERE organization_id = ${ctx.organizationId}
      AND status = 'active'
      AND account_type IN ('employee', 'super-admin')
      AND id != ${excludeUserId}
    ORDER BY full_name
  `);
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
  // DISTINCT ON: the single newest row per conversation, in one query; its
  // files are counted alongside so a files-only message still has a preview.
  const rows = await db.query<PreviewRow & { conversationId: string }>(ctx, sql`
    SELECT last.conversation_id AS "conversationId", last.id, last.sender_id AS "senderId", last.body,
           last.deleted_at AS "deletedAt", last.created_at AS "createdAt",
           files.count::int AS "attachmentCount", files.first_kind AS "firstKind", files.first_name AS "firstName"
      FROM (
        SELECT DISTINCT ON (conversation_id) conversation_id, id, sender_id, body, deleted_at, created_at
          FROM message
         WHERE organization_id = ${ctx.organizationId} AND conversation_id = ANY(${[...conversationIds]}::uuid[])
         ORDER BY conversation_id, created_at DESC, id DESC
      ) last
      LEFT JOIN LATERAL (
        SELECT count(*) AS count,
               (array_agg(ma.kind ORDER BY ma.position))[1] AS first_kind,
               (array_agg(ma.file_name ORDER BY ma.position))[1] AS first_name
          FROM message_attachment ma
         WHERE ma.organization_id = ${ctx.organizationId} AND ma.message_id = last.id
      ) files ON true
  `);
  return new Map(rows.map((r) => [r.conversationId, toPreview(r)]));
}

interface PreviewRow {
  id: string;
  senderId: string;
  body: string | null;
  deletedAt: Date | null;
  createdAt: Date;
  attachmentCount: number | null;
  firstKind: AttachmentKind | null;
  firstName: string | null;
}

function toPreview(row: PreviewRow): MessagePreview {
  const unsent = row.deletedAt !== null;
  return {
    id: row.id,
    senderId: row.senderId,
    body: row.body,
    deletedAt: row.deletedAt,
    createdAt: row.createdAt,
    attachmentCount: unsent ? 0 : Number(row.attachmentCount ?? 0),
    firstAttachment: !unsent && row.firstKind && row.firstName ? { kind: row.firstKind, fileName: row.firstName } : null,
  };
}

async function pinCountsFor(ctx: RequestContext, conversationIds: readonly string[]): Promise<Map<string, number>> {
  if (conversationIds.length === 0) return new Map();
  const rows = await db.query<{ conversationId: string; count: number }>(ctx, sql`
    SELECT conversation_id AS "conversationId", count(*)::int AS count
      FROM message_pin
     WHERE organization_id = ${ctx.organizationId} AND conversation_id = ANY(${[...conversationIds]}::uuid[])
     GROUP BY conversation_id
  `);
  return new Map(rows.map((r) => [r.conversationId, r.count]));
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

/** Unread message totals across every active conversation the current user can access. */
export async function unreadSummaryForUser(ctx: RequestContext): Promise<ChatUnreadSummary> {
  const rows = await db.query<{ kind: ConversationKind; count: string }>(ctx, sql`
    SELECT c.kind, count(m.id)::text AS count
    FROM conversation c
    JOIN conversation_member cm
      ON cm.organization_id = c.organization_id
     AND cm.conversation_id = c.id
     AND cm.user_id = ${ctx.principal.id}
     AND cm.left_at IS NULL
    LEFT JOIN message m
      ON m.organization_id = c.organization_id
     AND m.conversation_id = c.id
     AND m.sender_id <> ${ctx.principal.id}
     AND (cm.last_read_at IS NULL OR m.created_at > cm.last_read_at)
    WHERE c.organization_id = ${ctx.organizationId}
      AND c.archived_at IS NULL
    GROUP BY c.kind
  `);
  const counts = { direct: 0, group: 0, project: 0 };
  for (const row of rows) counts[row.kind] = Number(row.count);
  return { ...counts, total: counts.direct + counts.group + counts.project };
}

function toConversation(
  row: ConversationRow,
  members: Map<string, ConversationMember[]>,
  lastMessages: Map<string, MessagePreview>,
  unread: Map<string, number>,
  pins: Map<string, number>,
): Conversation {
  return {
    id: row.id,
    organizationId: row.organizationId,
    kind: row.kind,
    name: row.name,
    description: row.description,
    projectId: row.projectId,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    members: members.get(row.id) ?? [],
    lastMessage: lastMessages.get(row.id) ?? null,
    unreadCount: unread.get(row.id) ?? 0,
    pinnedCount: pins.get(row.id) ?? 0,
  };
}

/** My conversations, newest activity first. `kind` narrows to one tab (e.g. 'direct'). */
export async function listConversationsForUser(ctx: RequestContext, kind?: ConversationKind): Promise<Conversation[]> {
  const rows = await db.query<ConversationRow & { lastActivityAt: Date }>(ctx, sql`
    SELECT c.id, c.organization_id, c.kind, c.name, c.description, c.project_id, c.created_by, c.created_at,
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
  const [members, lastMessages, unread, pins] = await Promise.all([
    membersFor(ctx, ids),
    lastMessagesFor(ctx, ids),
    unreadCountsFor(ctx, ids),
    pinCountsFor(ctx, ids),
  ]);
  return rows.map((row) => toConversation(row, members, lastMessages, unread, pins));
}

export async function findConversationById(ctx: RequestContext, id: string): Promise<Conversation | null> {
  const row = await db.maybeOne<ConversationRow>(ctx, sql`
    SELECT id, organization_id, kind, name, description, project_id, created_by, created_at
    FROM conversation WHERE organization_id = ${ctx.organizationId} AND id = ${id}
  `);
  if (!row) return null;
  const [members, lastMessages, unread, pins] = await Promise.all([
    membersFor(ctx, [id]),
    lastMessagesFor(ctx, [id]),
    unreadCountsFor(ctx, [id]),
    pinCountsFor(ctx, [id]),
  ]);
  return toConversation(row, members, lastMessages, unread, pins);
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
  input: { kind: 'group' | 'project'; name: string; description?: string | null | undefined; memberIds: readonly string[]; projectId?: string | null },
): Promise<{ id: string }> {
  const created = await tx.one<{ id: string }>(sql`
    INSERT INTO conversation (organization_id, kind, name, description, project_id, created_by)
    VALUES (${organizationId}, ${input.kind}, ${input.name}, ${input.description ?? null}, ${input.projectId ?? null}, ${createdBy})
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

/** Generic company chats cannot target client portal accounts. */
export async function validateEmployeeMemberIds(tx: Tx, organizationId: string, userIds: readonly string[]): Promise<string[]> {
  if (userIds.length === 0) return [];
  const rows = await tx.query<{ id: string }>(sql`
    SELECT id FROM app_user
    WHERE organization_id = ${organizationId} AND id = ANY(${[...userIds]}::uuid[])
      AND status = 'active' AND account_type IN ('employee', 'super-admin')
  `);
  return rows.map((row) => row.id);
}

/** `kind` and `name`/`projectId` only, never `direct_pair_key` (dedup is direct-only, CH-1). */
export async function findConversationKind(ctx: RequestContext, id: string): Promise<{ kind: ConversationKind; name: string | null } | null> {
  return db.maybeOne<{ kind: ConversationKind; name: string | null }>(ctx, sql`
    SELECT kind, name FROM conversation WHERE organization_id = ${ctx.organizationId} AND id = ${id}
  `);
}

/** Same lookup, participating in a caller's open transaction. */
export async function findConversationKindTx(tx: Tx, organizationId: string, id: string): Promise<{ kind: ConversationKind; name: string | null } | null> {
  return tx.maybeOne<{ kind: ConversationKind; name: string | null }>(sql`
    SELECT kind, name FROM conversation WHERE organization_id = ${organizationId} AND id = ${id}
  `);
}

export async function renameConversation(tx: Tx, organizationId: string, id: string, name: string, description?: string | null): Promise<void> {
  await tx.query(sql`
    UPDATE conversation
    SET name = ${name}, description = ${description === undefined ? sql.raw('description') : description}, updated_at = now()
    WHERE organization_id = ${organizationId} AND id = ${id}
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

/**
 * Everything a message renders beyond its own row: reactions, mentions,
 * read receipts, the replied-to preview, files, link previews, its pin and
 * whether the VIEWER saved it. One query per facet for the whole page.
 * An unsent message keeps only its tombstone: no files, previews or pin.
 */
async function attachDerived(ctx: RequestContext, conversationId: string, rows: MessageRow[]): Promise<Message[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const liveIds = rows.filter((r) => r.deletedAt === null).map((r) => r.id);

  const [reactionRows, mentionRows, membersByConversation, replyRows, attachments, previews, pinRows, savedRows] = await Promise.all([
    db.query<{ messageId: string } & MessageReaction>(ctx, sql`
      SELECT message_id AS "messageId", user_id AS "userId", emoji FROM message_reaction
      WHERE organization_id = ${ctx.organizationId} AND message_id = ANY(${ids}::uuid[])
      ORDER BY created_at
    `),
    db.query<{ messageId: string; userId: string; fullName: string }>(ctx, sql`
      SELECT mm.message_id AS "messageId", mm.user_id AS "userId", u.full_name AS "fullName"
      FROM message_mention mm
      JOIN app_user u ON u.organization_id = mm.organization_id AND u.id = mm.user_id
      WHERE mm.organization_id = ${ctx.organizationId} AND mm.message_id = ANY(${ids}::uuid[])
    `),
    membersFor(ctx, [conversationId]),
    (async () => {
      const replyIds = [...new Set(rows.map((r) => r.replyToMessageId).filter((id): id is string => id !== null))];
      if (replyIds.length === 0) return new Map<string, MessagePreview>();
      const previewRows = await db.query<PreviewRow>(ctx, sql`
        SELECT m.id, m.sender_id AS "senderId", m.body, m.deleted_at AS "deletedAt", m.created_at AS "createdAt",
               files.count::int AS "attachmentCount", files.first_kind AS "firstKind", files.first_name AS "firstName"
          FROM message m
          LEFT JOIN LATERAL (
            SELECT count(*) AS count,
                   (array_agg(ma.kind ORDER BY ma.position))[1] AS first_kind,
                   (array_agg(ma.file_name ORDER BY ma.position))[1] AS first_name
              FROM message_attachment ma
             WHERE ma.organization_id = m.organization_id AND ma.message_id = m.id
          ) files ON true
         WHERE m.organization_id = ${ctx.organizationId} AND m.id = ANY(${replyIds}::uuid[])
      `);
      return new Map(previewRows.map((p) => [p.id, toPreview(p)]));
    })(),
    attachmentsForMessages(ctx, liveIds),
    previewsForMessages(ctx, liveIds),
    db.query<{ messageId: string; pinnedAt: Date; pinnedBy: string }>(ctx, sql`
      SELECT message_id AS "messageId", pinned_at AS "pinnedAt", pinned_by AS "pinnedBy" FROM message_pin
      WHERE organization_id = ${ctx.organizationId} AND message_id = ANY(${ids}::uuid[])
    `),
    db.query<{ messageId: string }>(ctx, sql`
      SELECT message_id AS "messageId" FROM message_star
      WHERE organization_id = ${ctx.organizationId} AND user_id = ${ctx.principal.id} AND message_id = ANY(${ids}::uuid[])
    `),
  ]);
  const members = membersByConversation.get(conversationId) ?? [];
  const pins = new Map(pinRows.map((p) => [p.messageId, p]));
  const saved = new Set(savedRows.map((r) => r.messageId));

  const reactionsByMessage = new Map<string, MessageReaction[]>();
  for (const r of reactionRows) {
    const list = reactionsByMessage.get(r.messageId) ?? [];
    list.push({ userId: r.userId, emoji: r.emoji });
    reactionsByMessage.set(r.messageId, list);
  }

  const mentionsByMessage = new Map<string, MessageMention[]>();
  for (const m of mentionRows) {
    const list = mentionsByMessage.get(m.messageId) ?? [];
    list.push({ userId: m.userId, fullName: m.fullName });
    mentionsByMessage.set(m.messageId, list);
  }

  return rows.map((row) => {
    const pin = pins.get(row.id);
    return {
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
      editedAt: row.deletedAt ? null : row.editedAt,
      reactions: reactionsByMessage.get(row.id) ?? [],
      // "Seen by": other members whose read cursor has reached this message.
      seenBy: members.filter((m) => m.userId !== row.senderId && m.lastReadAt !== null && m.lastReadAt >= row.createdAt).map((m) => m.userId),
      mentions: mentionsByMessage.get(row.id) ?? [],
      attachments: attachments.get(row.id) ?? [],
      linkPreviews: previews.get(row.id) ?? [],
      pinnedAt: pin?.pinnedAt ?? null,
      pinnedBy: pin?.pinnedBy ?? null,
      saved: saved.has(row.id),
    };
  });
}

/**
 * A keyset bound at the cursor message's EXACT timestamp. Cursors carry the
 * time to the millisecond while PostgreSQL stores microseconds, so the
 * message's own row is the authority when it exists (it always does:
 * messages are tombstoned, never deleted).
 */
function cursorTime(organizationId: string, cursor: { createdAt: Date; id: string }) {
  return sql`COALESCE((SELECT cm.created_at FROM message cm WHERE cm.organization_id = ${organizationId} AND cm.id = ${cursor.id}::uuid), ${cursor.createdAt}::timestamptz)`;
}

/** Messages of one conversation, NEWEST first, strictly older than `cursor` (or the newest page). */
export async function listMessages(
  ctx: RequestContext,
  conversationId: string,
  options: { limit: number; cursor: { createdAt: Date; id: string } | null },
): Promise<Message[]> {
  const bound = options.cursor
    ? sql`AND (created_at, id) < (${cursorTime(ctx.organizationId, options.cursor)}, ${options.cursor.id}::uuid)`
    : sql``;
  const rows = await db.query<MessageRow>(ctx, sql`
    SELECT ${MESSAGE_COLUMNS}
    FROM message
    WHERE organization_id = ${ctx.organizationId} AND conversation_id = ${conversationId}
      ${bound}
    ORDER BY created_at DESC, id DESC
    LIMIT ${options.limit}
  `);
  return attachDerived(ctx, conversationId, rows);
}

/** Messages strictly NEWER than `after`, the `limit` closest to it, returned newest first like every page. */
export async function listMessagesAfter(
  ctx: RequestContext,
  conversationId: string,
  options: { limit: number; after: { createdAt: Date; id: string } },
): Promise<Message[]> {
  const rows = await db.query<MessageRow>(ctx, sql`
    SELECT ${MESSAGE_COLUMNS}
    FROM message
    WHERE organization_id = ${ctx.organizationId} AND conversation_id = ${conversationId}
      AND (created_at, id) > (${cursorTime(ctx.organizationId, options.after)}, ${options.after.id}::uuid)
    ORDER BY created_at ASC, id ASC
    LIMIT ${options.limit}
  `);
  return attachDerived(ctx, conversationId, rows.reverse());
}

/**
 * A window centred on one message: up to `before` messages at-or-before it
 * (the target included) and up to `after` after it, each newest first.
 */
export async function listMessagesAround(
  ctx: RequestContext,
  conversationId: string,
  targetId: string,
  options: { before: number; after: number },
): Promise<{ atOrBefore: Message[]; after: Message[] }> {
  const target = sql`(SELECT t.created_at, t.id FROM message t WHERE t.organization_id = ${ctx.organizationId} AND t.id = ${targetId}::uuid)`;
  const [older, newer] = await Promise.all([
    db.query<MessageRow>(ctx, sql`
      SELECT ${MESSAGE_COLUMNS} FROM message
      WHERE organization_id = ${ctx.organizationId} AND conversation_id = ${conversationId}
        AND (created_at, id) <= ${target}
      ORDER BY created_at DESC, id DESC
      LIMIT ${options.before}
    `),
    db.query<MessageRow>(ctx, sql`
      SELECT ${MESSAGE_COLUMNS} FROM message
      WHERE organization_id = ${ctx.organizationId} AND conversation_id = ${conversationId}
        AND (created_at, id) > ${target}
      ORDER BY created_at ASC, id ASC
      LIMIT ${options.after}
    `),
  ]);
  const [atOrBefore, after] = await Promise.all([
    attachDerived(ctx, conversationId, older),
    attachDerived(ctx, conversationId, newer.reverse()),
  ]);
  return { atOrBefore, after };
}

/** The core row only — for authorization loaders and checks that need no rendering. */
export async function findMessageRow(ctx: RequestContext, id: string): Promise<MessageRow | null> {
  return db.maybeOne<MessageRow>(ctx, sql`
    SELECT ${MESSAGE_COLUMNS} FROM message WHERE organization_id = ${ctx.organizationId} AND id = ${id}
  `);
}

export async function findMessageRowTx(tx: Tx, organizationId: string, id: string, forUpdate = false): Promise<MessageRow | null> {
  return tx.maybeOne<MessageRow>(sql`
    SELECT ${MESSAGE_COLUMNS} FROM message WHERE organization_id = ${organizationId} AND id = ${id}
    ${forUpdate ? sql.raw('FOR UPDATE') : sql.raw('')}
  `);
}

export type { MessageRow };

export async function findMessageById(ctx: RequestContext, id: string): Promise<Message | null> {
  const row = await findMessageRow(ctx, id);
  if (!row) return null;
  const [message] = await attachDerived(ctx, row.conversationId, [row]);
  return message ?? null;
}

/** Full DTOs for messages that may span conversations (saved tray, pins, search jump). */
export async function findMessagesByIds(ctx: RequestContext, ids: readonly string[]): Promise<Map<string, Message>> {
  if (ids.length === 0) return new Map();
  const rows = await db.query<MessageRow>(ctx, sql`
    SELECT ${MESSAGE_COLUMNS} FROM message WHERE organization_id = ${ctx.organizationId} AND id = ANY(${[...ids]}::uuid[])
  `);
  const byConversation = new Map<string, MessageRow[]>();
  for (const row of rows) byConversation.set(row.conversationId, [...(byConversation.get(row.conversationId) ?? []), row]);
  const result = new Map<string, Message>();
  for (const [conversationId, group] of byConversation) {
    for (const message of await attachDerived(ctx, conversationId, group)) result.set(message.id, message);
  }
  return result;
}

/** Only actual, current members of this conversation can be @mentioned — a stale id is silently dropped, never a 500. */
async function insertMentions(tx: Tx, organizationId: string, conversationId: string, messageId: string, mentionIds: readonly string[]): Promise<string[]> {
  if (mentionIds.length === 0) return [];
  const inserted = await tx.query<{ userId: string }>(sql`
    INSERT INTO message_mention (message_id, organization_id, user_id)
    SELECT ${messageId}, ${organizationId}, cm.user_id
    FROM conversation_member cm
    WHERE cm.organization_id = ${organizationId} AND cm.conversation_id = ${conversationId}
      AND cm.left_at IS NULL AND cm.user_id = ANY(${[...new Set(mentionIds)]}::uuid[])
    ON CONFLICT DO NOTHING
    RETURNING user_id
  `);
  return inserted.map((row) => row.userId);
}

/** The links a message contains, in order — written with the message so search sees them at once. */
export async function replaceMessageLinks(tx: Tx, organizationId: string, messageId: string, urls: readonly string[]): Promise<void> {
  await tx.query(sql`DELETE FROM message_link WHERE organization_id = ${organizationId} AND message_id = ${messageId}`);
  if (urls.length === 0) return;
  await tx.query(sql`
    INSERT INTO message_link (message_id, organization_id, url, position)
    SELECT ${messageId}, ${organizationId}, u.url, (u.ord - 1)::smallint
    FROM unnest(${[...urls]}::text[]) WITH ORDINALITY AS u(url, ord)
    ON CONFLICT DO NOTHING
  `);
}

export async function insertMessage(
  tx: Tx,
  organizationId: string,
  senderId: string,
  conversationId: string,
  input: { body: string; replyToMessageId?: string | null; forwarded?: boolean; forwardedFromSenderId?: string | null; mentionedUserIds?: readonly string[] | undefined },
): Promise<{ id: string; createdAt: Date }> {
  const created = await tx.one<{ id: string; createdAt: Date }>(sql`
    INSERT INTO message (organization_id, conversation_id, sender_id, body, reply_to_message_id, forwarded, forwarded_from_sender_id)
    VALUES (${organizationId}, ${conversationId}, ${senderId}, ${input.body}, ${input.replyToMessageId ?? null},
            ${input.forwarded ?? false}, ${input.forwardedFromSenderId ?? null})
    RETURNING id, created_at AS "createdAt"
  `);
  await insertMentions(tx, organizationId, conversationId, created.id, input.mentionedUserIds ?? []);
  return created;
}

/**
 * Unsend: a tombstone (product decision) — the row and its timestamp remain,
 * but the content does not: body, edit history, pin and link rows go, and
 * its files stop being served (the file route checks `deleted_at`).
 */
export async function unsendMessage(tx: Tx, organizationId: string, id: string, deletedBy: string): Promise<void> {
  await tx.query(sql`
    UPDATE message SET body = NULL, deleted_at = now(), deleted_by = ${deletedBy}
    WHERE organization_id = ${organizationId} AND id = ${id}
  `);
  await tx.query(sql`DELETE FROM message_edit WHERE organization_id = ${organizationId} AND message_id = ${id}`);
  await tx.query(sql`DELETE FROM message_pin WHERE organization_id = ${organizationId} AND message_id = ${id}`);
  await tx.query(sql`DELETE FROM message_link WHERE organization_id = ${organizationId} AND message_id = ${id}`);
}

/**
 * Edit: the previous text goes to `message_edit`, the mentions are replaced
 * by the new set. Returns who is NEWLY mentioned (to notify them).
 */
export async function editMessageBody(
  tx: Tx,
  input: { organizationId: string; conversationId: string; messageId: string; editorId: string; previousBody: string; body: string; mentionedUserIds: readonly string[] },
): Promise<{ newlyMentioned: string[] }> {
  await tx.query(sql`
    INSERT INTO message_edit (organization_id, message_id, previous_body, edited_by)
    VALUES (${input.organizationId}, ${input.messageId}, ${input.previousBody}, ${input.editorId})
  `);
  await tx.query(sql`
    UPDATE message SET body = ${input.body}, edited_at = now()
    WHERE organization_id = ${input.organizationId} AND id = ${input.messageId}
  `);
  const before = await tx.query<{ userId: string }>(sql`
    DELETE FROM message_mention WHERE organization_id = ${input.organizationId} AND message_id = ${input.messageId}
    RETURNING user_id
  `);
  const after = await insertMentions(tx, input.organizationId, input.conversationId, input.messageId, input.mentionedUserIds);
  const previously = new Set(before.map((row) => row.userId));
  return { newlyMentioned: after.filter((userId) => !previously.has(userId)) };
}

export async function listMessageEdits(ctx: RequestContext, messageId: string): Promise<MessageEdit[]> {
  return db.query<MessageEdit>(ctx, sql`
    SELECT id, previous_body AS "previousBody", edited_by AS "editedBy", edited_at AS "editedAt"
    FROM message_edit
    WHERE organization_id = ${ctx.organizationId} AND message_id = ${messageId}
    ORDER BY edited_at DESC, id DESC
  `);
}

export async function addReaction(tx: Tx, organizationId: string, messageId: string, userId: string, emoji: string): Promise<boolean> {
  const inserted = await tx.query<{ messageId: string }>(sql`
    INSERT INTO message_reaction (message_id, organization_id, user_id, emoji)
    VALUES (${messageId}, ${organizationId}, ${userId}, ${emoji})
    ON CONFLICT (message_id, user_id, emoji) DO NOTHING
    RETURNING message_id
  `);
  return inserted.length > 0;
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

/* ---------------------------------- pins ---------------------------------- */

export const MAX_PINS_PER_CONVERSATION = 50;

/** 'pinned' (new pin), 'already' (no change) or 'full' (the conversation is at its pin limit). */
export async function pinMessage(
  tx: Tx,
  input: { organizationId: string; conversationId: string; messageId: string; userId: string },
): Promise<'pinned' | 'already' | 'full'> {
  const already = await tx.maybeOne<{ messageId: string }>(sql`
    SELECT message_id AS "messageId" FROM message_pin WHERE organization_id = ${input.organizationId} AND message_id = ${input.messageId}
  `);
  if (already) return 'already';
  if ((await countPins(tx, input.organizationId, input.conversationId)) >= MAX_PINS_PER_CONVERSATION) return 'full';
  await tx.query(sql`
    INSERT INTO message_pin (conversation_id, message_id, organization_id, pinned_by)
    VALUES (${input.conversationId}, ${input.messageId}, ${input.organizationId}, ${input.userId})
    ON CONFLICT DO NOTHING
  `);
  return 'pinned';
}

export async function countPins(tx: Tx, organizationId: string, conversationId: string): Promise<number> {
  const row = await tx.one<{ count: number }>(sql`
    SELECT count(*)::int AS count FROM message_pin WHERE organization_id = ${organizationId} AND conversation_id = ${conversationId}
  `);
  return row.count;
}

export async function unpinMessage(tx: Tx, organizationId: string, messageId: string): Promise<boolean> {
  const removed = await tx.query<{ messageId: string }>(sql`
    DELETE FROM message_pin WHERE organization_id = ${organizationId} AND message_id = ${messageId} RETURNING message_id
  `);
  return removed.length > 0;
}

export async function listPinRows(ctx: RequestContext, conversationId: string): Promise<{ messageId: string; pinnedAt: Date; pinnedBy: string; pinnedByName: string }[]> {
  return db.query(ctx, sql`
    SELECT p.message_id AS "messageId", p.pinned_at AS "pinnedAt", p.pinned_by AS "pinnedBy", u.full_name AS "pinnedByName"
    FROM message_pin p
    JOIN app_user u ON u.organization_id = p.organization_id AND u.id = p.pinned_by
    WHERE p.organization_id = ${ctx.organizationId} AND p.conversation_id = ${conversationId}
    ORDER BY p.pinned_at DESC, p.message_id DESC
  `);
}

/* --------------------------------- saved ---------------------------------- */

export async function saveMessage(tx: Tx, input: { organizationId: string; conversationId: string; messageId: string; userId: string }): Promise<void> {
  await tx.query(sql`
    INSERT INTO message_star (user_id, message_id, organization_id, conversation_id)
    VALUES (${input.userId}, ${input.messageId}, ${input.organizationId}, ${input.conversationId})
    ON CONFLICT (user_id, message_id) DO NOTHING
  `);
}

export async function unsaveMessage(tx: Tx, organizationId: string, messageId: string, userId: string): Promise<void> {
  await tx.query(sql`
    DELETE FROM message_star WHERE organization_id = ${organizationId} AND message_id = ${messageId} AND user_id = ${userId}
  `);
}

/** My saved messages, newest saved first, only from conversations I still belong to. */
export async function listSavedRows(
  ctx: RequestContext,
  options: { limit: number; cursor: { createdAt: Date; id: string } | null },
): Promise<{ messageId: string; savedAt: Date; conversationId: string; kind: ConversationKind; name: string | null; projectId: string | null; senderName: string; otherMemberName: string | null }[]> {
  const cursorAt = options.cursor?.createdAt ?? null;
  const cursorId = options.cursor?.id ?? null;
  return db.query(ctx, sql`
    SELECT s.message_id AS "messageId", s.created_at AS "savedAt", c.id AS "conversationId", c.kind, c.name,
           c.project_id AS "projectId", u.full_name AS "senderName",
           CASE WHEN c.kind = 'direct' THEN (
             SELECT ou.full_name FROM conversation_member ocm
             JOIN app_user ou ON ou.organization_id = ocm.organization_id AND ou.id = ocm.user_id
             WHERE ocm.organization_id = c.organization_id AND ocm.conversation_id = c.id AND ocm.user_id <> ${ctx.principal.id}
             LIMIT 1
           ) END AS "otherMemberName"
    FROM message_star s
    JOIN conversation c ON c.organization_id = s.organization_id AND c.id = s.conversation_id AND c.archived_at IS NULL
    JOIN conversation_member cm ON cm.organization_id = c.organization_id AND cm.conversation_id = c.id
     AND cm.user_id = ${ctx.principal.id} AND cm.left_at IS NULL
    JOIN message m ON m.organization_id = s.organization_id AND m.id = s.message_id
    JOIN app_user u ON u.organization_id = m.organization_id AND u.id = m.sender_id
    WHERE s.organization_id = ${ctx.organizationId} AND s.user_id = ${ctx.principal.id}
      AND (${cursorAt}::timestamptz IS NULL OR (s.created_at, s.message_id) < (${cursorAt}::timestamptz, ${cursorId}::uuid))
    ORDER BY s.created_at DESC, s.message_id DESC
    LIMIT ${options.limit}
  `);
}
