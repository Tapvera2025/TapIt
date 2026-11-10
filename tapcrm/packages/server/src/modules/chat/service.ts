import type { Resource } from '@tapcrm/authz';
import type { Principal } from '@tapcrm/contracts';
import { createJobContext, type RequestContext } from '../../platform/dal/context.js';
import { db, type Tx } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import { emitToUser, installConnectionListener, installTypingAuthorizer } from '../../platform/realtime/index.js';
import { claimPendingAttachments, copyAttachments, findAttachmentConversation } from './attachments.js';
import { ChatEditWindowClosedError, ChatNotFoundError, ChatNotSenderError, ChatValidationError } from './errors.js';
import { refreshLinkPreviews } from './link-preview.js';
import { extractLinks } from './links.js';
import { connectionChanged } from './presence.js';
import {
  addConversationMembers,
  addReaction,
  archiveConversation,
  authorizedProjectMemberIds,
  conversationMemberIds,
  conversationMemberIdsTx,
  createGroupConversation,
  decodeMessageCursor,
  editMessageBody,
  encodeMessageCursor,
  findConversationById,
  findConversationKind,
  findConversationKindTx,
  findMessageById,
  findMessageRow,
  findMessageRowTx,
  findMessagesByIds,
  findOrCreateDirectConversation,
  findUserFullName,
  insertMessage,
  listColleagues as repoListColleagues,
  listConversationsForUser,
  listMessageEdits,
  listMessagesAfter,
  listMessagesAround,
  listPinRows,
  listSavedRows,
  unreadSummaryForUser,
  listMessages as repoListMessages,
  markConversationRead,
  MAX_PINS_PER_CONVERSATION,
  pinMessage as repoPinMessage,
  removeConversationMember,
  removeReaction,
  renameConversation,
  replaceMessageLinks,
  saveMessage as repoSaveMessage,
  unpinMessage as repoUnpinMessage,
  unsaveMessage as repoUnsaveMessage,
  unsendMessage as repoUnsendMessage,
  validateEmployeeMemberIds,
} from './repository.js';
import {
  messageSummary,
  notifyGroupMemberRemoved,
  notifyGroupMembersAdded,
  notifyMention,
  notifyNewMessage,
  notifyReaction,
} from './notifications.js';
import type {
  Conversation,
  ConversationKind,
  ConversationResource,
  Message,
  MessageEdit,
  PinnedMessage,
  ReactionEmoji,
  SavedMessage,
} from './types.js';
import type { ListMessagesQuery } from './validators.js';

/** A sender may correct a message for this long after sending it (product decision). */
export const EDIT_WINDOW_MINUTES = 15;

/** A raw socket event, not an HTTP request, has no principal (TN-9: jobs/sockets build a context explicitly). */
function relayPrincipal(organizationId: string): Principal {
  return {
    id: '00000000-0000-0000-0000-000000000000',
    organizationId,
    sessionVersion: 0,
    accountType: 'service',
    allowedActions: [],
    allowedResources: [],
    expiresAt: new Date(0),
  };
}

/** A tenant context for work that runs after the request (fan-out, link previews). */
export function backgroundContext(organizationId: string, jobName: string, runId: string): RequestContext {
  return createJobContext({ organizationId, principal: relayPrincipal(organizationId), jobName, runId });
}

/**
 * Called once at boot — wires the typing relay to conversation membership,
 * and refreshes colleagues' presence dots when someone opens or closes TapIt.
 */
export function registerChatRealtime(): void {
  installTypingAuthorizer(async (organizationId, userId, conversationId) => {
    const ctx = backgroundContext(organizationId, 'chat-typing-relay', 'socket');
    const ids = await authorizedProjectMemberIds(ctx, conversationId);
    if (!ids || !ids.includes(userId)) return null;
    return ids;
  });
  installConnectionListener(connectionChanged);
}

function toResource(conversationId: string, organizationId: string, memberIds: readonly string[]): ConversationResource {
  return { type: 'chatConversation', id: conversationId, organizationId, memberIds };
}

/** For routes bound with `resourceParam: 'id'` naming a CONVERSATION id. */
export async function loadConversationResource(ctx: RequestContext, id: string): Promise<Resource | null> {
  if (ctx.principal.accountType === 'client') return null;
  const memberIds = await conversationMemberIds(ctx, id);
  if (memberIds === null) return null;
  return toResource(id, ctx.organizationId, memberIds);
}

/** For routes bound with `resourceParam: 'id'` naming a MESSAGE id — resolves to its conversation. */
export async function loadMessageResource(ctx: RequestContext, id: string): Promise<Resource | null> {
  if (ctx.principal.accountType === 'client') return null;
  const message = await findMessageRow(ctx, id);
  if (!message) return null;
  const memberIds = await conversationMemberIds(ctx, message.conversationId);
  if (memberIds === null) return null;
  return toResource(message.conversationId, ctx.organizationId, memberIds);
}

/** For routes naming an ATTACHMENT id — resolves to the conversation it was uploaded into. */
export async function loadAttachmentResource(ctx: RequestContext, id: string): Promise<Resource | null> {
  if (ctx.principal.accountType === 'client') return null;
  const conversationId = await findAttachmentConversation(ctx, id);
  if (!conversationId) return null;
  const memberIds = await conversationMemberIds(ctx, conversationId);
  if (memberIds === null) return null;
  return toResource(conversationId, ctx.organizationId, memberIds);
}

export async function listConversations(ctx: RequestContext, kind?: ConversationKind): Promise<Conversation[]> {
  return listConversationsForUser(ctx, kind);
}

export async function getUnreadSummary(ctx: RequestContext) {
  return unreadSummaryForUser(ctx);
}

export async function listColleagues(ctx: RequestContext): Promise<{ id: string; fullName: string }[]> {
  return repoListColleagues(ctx, ctx.principal.id);
}

export async function getConversation(ctx: RequestContext, id: string): Promise<Conversation> {
  const conversation = await findConversationById(ctx, id);
  if (!conversation) throw new ChatNotFoundError('conversation');
  return conversation;
}

/** Opens (or reuses) the DM with `otherUserId`. Reusing is why re-opening the same person never forks the thread. */
export async function startDirectConversation(ctx: RequestContext, otherUserId: string): Promise<Conversation> {
  if (otherUserId === ctx.principal.id) throw new ChatValidationError('You cannot start a direct conversation with yourself');

  const { id, created } = await db.transaction(ctx, async (tx) => {
    const [valid] = await validateEmployeeMemberIds(tx, ctx.organizationId, [otherUserId]);
    if (!valid) throw new ChatValidationError('That person is not an active member of this organization', { userId: otherUserId });
    return findOrCreateDirectConversation(tx, ctx, otherUserId);
  });

  if (created) emitToUser(ctx.organizationId, otherUserId, 'chat:conversation:new', { id, kind: 'direct' });

  const conversation = await findConversationById(ctx, id);
  if (!conversation) throw new ChatNotFoundError('conversation');
  return conversation;
}

/** Internal Groups (Phase 3): Super-Admin-only at the route (`chat:manage-groups`). */
export async function createInternalGroup(ctx: RequestContext, input: { name: string; description?: string | null | undefined; memberIds: readonly string[] }): Promise<Conversation> {
  const { id } = await db.transaction(ctx, async (tx) => {
    const validIds = await validateEmployeeMemberIds(tx, ctx.organizationId, input.memberIds);
    if (validIds.length !== input.memberIds.length) {
      const missing = input.memberIds.filter((memberId) => !validIds.includes(memberId));
      throw new ChatValidationError('One or more members are not active in this organization', { missingUserIds: missing });
    }
    const created = await createGroupConversation(tx, ctx.organizationId, ctx.principal.id, { kind: 'group', name: input.name, description: input.description, memberIds: validIds });
    await notifyGroupMembersAdded(tx, ctx, { id: created.id, name: input.name }, validIds);
    return created;
  });

  const conversation = await findConversationById(ctx, id);
  if (!conversation) throw new ChatNotFoundError('conversation');
  for (const member of conversation.members) {
    if (member.userId === ctx.principal.id) continue;
    emitToUser(ctx.organizationId, member.userId, 'chat:conversation:new', { id, kind: 'group' });
  }
  return conversation;
}

/**
 * A group's ONLY governance route is Super Admin (per product decision:
 * simpler than a per-group delegate, and matches how this codebase already
 * treats `chat:manage-groups` — SuperAdminOnly in the registry, so `authorize`
 * never even reaches `chatConversationPolicy.check` for these actions; a
 * caller here is Super Admin by construction). Every function below still
 * refuses to touch a 'direct' or 'project' conversation — Phase 4's project
 * groups are managed by the projects module's own action, not this one.
 */
async function requireGroup(ctx: RequestContext, id: string): Promise<void> {
  const conversation = await findConversationKind(ctx, id);
  if (!conversation) throw new ChatNotFoundError('conversation');
  if (conversation.kind !== 'group') {
    throw new ChatValidationError('Only an Internal Group can be managed this way', { kind: conversation.kind });
  }
}

async function notifyOtherMembers(ctx: RequestContext, conversationId: string, event: 'chat:conversation:updated', extra: Record<string, unknown> = {}): Promise<void> {
  const memberIds = await conversationMemberIds(ctx, conversationId);
  for (const memberId of memberIds ?? []) {
    if (memberId === ctx.principal.id) continue;
    emitToUser(ctx.organizationId, memberId, event, { id: conversationId, ...extra });
  }
}

export async function renameGroup(ctx: RequestContext, id: string, name: string, description?: string | null): Promise<Conversation> {
  await requireGroup(ctx, id);
  await db.transaction(ctx, (tx) => renameConversation(tx, ctx.organizationId, id, name, description));
  await notifyOtherMembers(ctx, id, 'chat:conversation:updated');
  const conversation = await findConversationById(ctx, id);
  if (!conversation) throw new ChatNotFoundError('conversation');
  return conversation;
}

export async function addGroupMembers(ctx: RequestContext, id: string, memberIds: readonly string[]): Promise<Conversation> {
  await requireGroup(ctx, id);
  await db.transaction(ctx, async (tx) => {
    const validIds = await validateEmployeeMemberIds(tx, ctx.organizationId, memberIds);
    if (validIds.length !== memberIds.length) {
      const missing = memberIds.filter((memberId) => !validIds.includes(memberId));
      throw new ChatValidationError('One or more members are not active in this organization', { missingUserIds: missing });
    }
    await addConversationMembers(tx, ctx.organizationId, id, validIds);
    const conversation = await findConversationKindTx(tx, ctx.organizationId, id);
    await notifyGroupMembersAdded(tx, ctx, { id, name: conversation?.name ?? null }, validIds);
  });

  const conversation = await findConversationById(ctx, id);
  if (!conversation) throw new ChatNotFoundError('conversation');
  for (const memberId of memberIds) {
    if (memberId === ctx.principal.id) continue;
    emitToUser(ctx.organizationId, memberId, 'chat:conversation:new', { id, kind: 'group' });
  }
  await notifyOtherMembers(ctx, id, 'chat:conversation:updated');
  return conversation;
}

/** The removed member is told separately (a bare id, RT-4) so their client drops the conversation from its list. */
export async function removeGroupMember(ctx: RequestContext, id: string, userId: string): Promise<Conversation> {
  await requireGroup(ctx, id);
  await db.transaction(ctx, async (tx) => {
    await removeConversationMember(tx, ctx.organizationId, id, userId);
    const conversation = await findConversationKindTx(tx, ctx.organizationId, id);
    await notifyGroupMemberRemoved(tx, ctx, { id, name: conversation?.name ?? null }, userId);
  });

  emitToUser(ctx.organizationId, userId, 'chat:conversation:updated', { id, removed: true });
  const conversation = await findConversationById(ctx, id);
  if (!conversation) throw new ChatNotFoundError('conversation');
  await notifyOtherMembers(ctx, id, 'chat:conversation:updated');
  return conversation;
}

export async function archiveGroup(ctx: RequestContext, id: string): Promise<{ archived: true }> {
  await requireGroup(ctx, id);
  await db.transaction(ctx, (tx) => archiveConversation(tx, ctx.organizationId, id));
  await notifyOtherMembers(ctx, id, 'chat:conversation:updated', { archived: true });
  return { archived: true };
}

/* ------------------------------------------------------------------ *
 * Reading a thread
 * ------------------------------------------------------------------ */

export interface MessagePage {
  /** Newest first, like every page. */
  readonly messages: Message[];
  /** Pages OLDER than the oldest message here; null at the start of the thread. */
  readonly nextCursor: string | null;
  /** Pages NEWER than the newest message here; null when this page reaches the latest message. */
  readonly newerCursor: string | null;
}

const cursorOf = (message: Message): string => encodeMessageCursor({ createdAt: message.createdAt.toISOString(), id: message.id });

export async function listMessages(ctx: RequestContext, conversationId: string, query: ListMessagesQuery): Promise<MessagePage> {
  if (query.around) {
    const target = await findMessageRow(ctx, query.around);
    if (!target || target.conversationId !== conversationId) throw new ChatNotFoundError('message');
    // Half a page either side of the target; one extra row each way says whether more exist.
    const half = Math.max(1, Math.floor(query.limit / 2));
    const around = await listMessagesAround(ctx, conversationId, query.around, { before: half + 2, after: half + 1 });
    const older = around.atOrBefore.slice(0, half + 1);
    const newer = around.after.slice(around.after.length > half ? around.after.length - half : 0);
    const messages = [...newer, ...older];
    const oldest = messages[messages.length - 1];
    const newest = messages[0];
    return {
      messages,
      nextCursor: around.atOrBefore.length > half + 1 && oldest ? cursorOf(oldest) : null,
      newerCursor: around.after.length > half && newest ? cursorOf(newest) : null,
    };
  }

  if (query.after) {
    const after = decodeMessageCursor(query.after);
    if (!after) return { messages: [], nextCursor: null, newerCursor: null };
    const rows = await listMessagesAfter(ctx, conversationId, { limit: query.limit + 1, after });
    // listMessagesAfter returns newest first; keep the OLDEST `limit` (closest to the cursor).
    const messages = rows.length > query.limit ? rows.slice(rows.length - query.limit) : rows;
    const newest = messages[0];
    return { messages, nextCursor: null, newerCursor: rows.length > query.limit && newest ? cursorOf(newest) : null };
  }

  const cursor = query.cursor ? decodeMessageCursor(query.cursor) : null;
  const rows = await repoListMessages(ctx, conversationId, { limit: query.limit + 1, cursor });
  const messages = rows.slice(0, query.limit);
  const last = messages[messages.length - 1];
  return { messages, nextCursor: rows.length > query.limit && last ? cursorOf(last) : null, newerCursor: null };
}

export async function getMessage(ctx: RequestContext, id: string): Promise<Message> {
  const message = await findMessageById(ctx, id);
  if (!message) throw new ChatNotFoundError('message');
  return message;
}

/* ------------------------------------------------------------------ *
 * Fan-out
 * ------------------------------------------------------------------ */

type ChatEvent = Parameters<typeof emitToUser>[2];

async function fanOut(ctx: RequestContext, conversationId: string, event: ChatEvent, payload: Record<string, unknown>, includeActor = false): Promise<void> {
  const memberIds = await authorizedProjectMemberIds(ctx, conversationId);
  for (const memberId of memberIds ?? []) {
    if (!includeActor && memberId === ctx.principal.id) continue;
    emitToUser(ctx.organizationId, memberId, event, payload);
  }
}

async function fanOutToOtherMembers(ctx: RequestContext, conversationId: string, event: ChatEvent, payload: Record<string, unknown>): Promise<void> {
  await fanOut(ctx, conversationId, event, payload, false);
}

/**
 * Link previews are fetched AFTER the message commits (an outbound HTTP
 * call never runs inside a transaction, TX-2) and never delay the send.
 * When a card becomes ready, every member — the sender included — is told
 * to refetch that one message. A preview missed here (process restart) is
 * picked up by the `chat.link-preview-sweep` job.
 */
export function unfurlInBackground(organizationId: string, conversationId: string, messageId: string, urls: readonly string[]): void {
  if (urls.length === 0) return;
  const ctx = backgroundContext(organizationId, 'chat.link-preview', messageId);
  void refreshLinkPreviews(ctx, urls)
    .then(async (changed) => {
      if (changed) await fanOut(ctx, conversationId, 'chat:message:updated', { conversationId, id: messageId }, true);
    })
    .catch((error: unknown) => {
      console.error(JSON.stringify({ level: 'warn', msg: 'chat link preview failed', messageId, error: String(error) }));
    });
}

/* ------------------------------------------------------------------ *
 * Sending
 * ------------------------------------------------------------------ */

export interface DeliverInput {
  readonly body: string;
  readonly replyToMessageId?: string | null | undefined;
  readonly mentionedUserIds?: readonly string[] | undefined;
  readonly attachmentIds?: readonly string[] | undefined;
}

/**
 * Writes one message and everything that belongs to the same commit: its
 * mentions, its links, the files it carries and its notifications. Shared by
 * a live send and a scheduled send (which runs as a job, for the sender).
 * `ctx.principal` is the actor notifications exclude.
 */
export async function deliverMessage(
  tx: Tx,
  ctx: Pick<RequestContext, 'organizationId' | 'principal'>,
  senderId: string,
  conversationId: string,
  input: DeliverInput,
  options: { claimAttachments?: boolean } = {},
): Promise<{ id: string; links: string[] }> {
  if (input.replyToMessageId) {
    const target = await findMessageRowTx(tx, ctx.organizationId, input.replyToMessageId);
    if (!target || target.conversationId !== conversationId) {
      throw new ChatValidationError('The message you are replying to is not in this conversation');
    }
  }
  const inserted = await insertMessage(tx, ctx.organizationId, senderId, conversationId, {
    body: input.body,
    replyToMessageId: input.replyToMessageId ?? null,
    mentionedUserIds: input.mentionedUserIds,
  });
  if (options.claimAttachments !== false && (input.attachmentIds?.length ?? 0) > 0) {
    await claimPendingAttachments(tx, {
      organizationId: ctx.organizationId,
      conversationId,
      uploaderId: senderId,
      attachmentIds: input.attachmentIds ?? [],
      target: { messageId: inserted.id },
    });
  }
  const links = extractLinks(input.body);
  await replaceMessageLinks(tx, ctx.organizationId, inserted.id, links);

  const [conversation, senderName, memberIds, files] = await Promise.all([
    findConversationKindTx(tx, ctx.organizationId, conversationId),
    findUserFullName(tx, ctx.organizationId, senderId),
    conversationMemberIdsTx(tx, ctx.organizationId, conversationId),
    tx.query<{ kind: 'image'; fileName: string }>(sql`
      SELECT kind, file_name AS "fileName" FROM message_attachment
      WHERE organization_id = ${ctx.organizationId} AND message_id = ${inserted.id} ORDER BY position
    `),
  ]);
  if (conversation) {
    await notifyNewMessage(tx, ctx, { id: conversationId, ...conversation }, senderName, messageSummary(input.body, files), inserted.id, memberIds);
    const mentioned = (input.mentionedUserIds ?? []).filter((id) => memberIds.includes(id));
    if (mentioned.length > 0) {
      await notifyMention(tx, ctx, { id: conversationId, ...conversation }, senderName, inserted.id, mentioned);
    }
  }
  return { id: inserted.id, links };
}

/** After a message commits: tell the other members, and start its link previews. */
export async function announceNewMessage(ctx: RequestContext, conversationId: string, messageId: string, links: readonly string[]): Promise<void> {
  await fanOutToOtherMembers(ctx, conversationId, 'chat:message:new', { conversationId, id: messageId });
  unfurlInBackground(ctx.organizationId, conversationId, messageId, links);
}

export async function sendMessage(ctx: RequestContext, conversationId: string, input: DeliverInput): Promise<Message> {
  const created = await db.transaction(ctx, (tx) => deliverMessage(tx, ctx, ctx.principal.id, conversationId, input));
  const message = await findMessageById(ctx, created.id);
  if (!message) throw new ChatNotFoundError('message');
  await announceNewMessage(ctx, conversationId, message.id, created.links);
  return message;
}

/** Copies the content (and files) into a conversation you belong to; the original may later be unsent without touching this copy. */
export async function forwardMessage(ctx: RequestContext, sourceMessageId: string, targetConversationId: string): Promise<Message> {
  const source = await findMessageById(ctx, sourceMessageId);
  if (!source) throw new ChatNotFoundError('message');
  if (source.deletedAt || source.body === null) throw new ChatValidationError('This message was unsent and cannot be forwarded');

  // The route authorizes the SOURCE message's conversation; the TARGET is a
  // second resource and is validated here, same division as `assignTask`'s
  // manual cross-organization check beyond the route-level check.
  const targetMemberIds = await conversationMemberIds(ctx, targetConversationId);
  if (targetMemberIds === null || !targetMemberIds.includes(ctx.principal.id)) {
    throw new ChatNotFoundError('conversation');
  }

  const links = extractLinks(source.body);
  const created = await db.transaction(ctx, async (tx) => {
    const inserted = await insertMessage(tx, ctx.organizationId, ctx.principal.id, targetConversationId, {
      body: source.body!,
      forwarded: true,
      forwardedFromSenderId: source.senderId,
    });
    await copyAttachments(tx, ctx.organizationId, source.id, { messageId: inserted.id, conversationId: targetConversationId });
    await replaceMessageLinks(tx, ctx.organizationId, inserted.id, links);
    const [conversation, senderName, memberIds] = await Promise.all([
      findConversationKindTx(tx, ctx.organizationId, targetConversationId),
      findUserFullName(tx, ctx.organizationId, ctx.principal.id),
      conversationMemberIdsTx(tx, ctx.organizationId, targetConversationId),
    ]);
    if (conversation) {
      await notifyNewMessage(tx, ctx, { id: targetConversationId, ...conversation }, senderName, messageSummary(source.body!, source.attachments), inserted.id, memberIds);
    }
    return inserted;
  });

  const message = await findMessageById(ctx, created.id);
  if (!message) throw new ChatNotFoundError('message');
  await announceNewMessage(ctx, targetConversationId, message.id, links);
  return message;
}

/** Tombstone, not a hard delete (product decision): body cleared, the row and its timestamp remain. */
export async function unsendMessage(ctx: RequestContext, id: string): Promise<Message> {
  const message = await findMessageRow(ctx, id);
  if (!message) throw new ChatNotFoundError('message');
  if (message.senderId !== ctx.principal.id) throw new ChatNotSenderError();
  if (message.deletedAt) return getMessage(ctx, id); // already unsent: idempotent, not an error

  await db.transaction(ctx, (tx) => repoUnsendMessage(tx, ctx.organizationId, id, ctx.principal.id));
  const updated = await getMessage(ctx, id);
  await fanOutToOtherMembers(ctx, message.conversationId, 'chat:message:unsent', { conversationId: message.conversationId, id });
  return updated;
}

/* ------------------------------------------------------------------ *
 * Editing
 * ------------------------------------------------------------------ */

/**
 * The sender corrects their own message within EDIT_WINDOW_MINUTES of
 * sending it. The replaced text is kept (message_edit), the mentions are
 * re-read from the new text and anyone NEWLY mentioned is notified; links
 * and their previews follow the new text. A forwarded message is someone
 * else's words and cannot be edited.
 */
export async function editMessage(
  ctx: RequestContext,
  id: string,
  input: { body: string; mentionedUserIds?: readonly string[] | undefined },
  now: Date = new Date(),
): Promise<Message> {
  const result = await db.transaction(ctx, async (tx) => {
    const message = await findMessageRowTx(tx, ctx.organizationId, id, true);
    if (!message) throw new ChatNotFoundError('message');
    if (message.senderId !== ctx.principal.id) throw new ChatNotSenderError();
    if (message.deletedAt || message.body === null) throw new ChatValidationError('This message was unsent and cannot be edited');
    if (message.forwarded) throw new ChatValidationError('A forwarded message cannot be edited');
    if (now.getTime() - message.createdAt.getTime() > EDIT_WINDOW_MINUTES * 60_000) throw new ChatEditWindowClosedError(EDIT_WINDOW_MINUTES);

    const hasFiles = await tx.maybeOne<{ id: string }>(sql`
      SELECT id FROM message_attachment WHERE organization_id = ${ctx.organizationId} AND message_id = ${id} LIMIT 1
    `);
    if (input.body.length === 0 && !hasFiles) throw new ChatValidationError('Message cannot be empty — unsend it instead');
    if (input.body === message.body) return { changed: false, conversationId: message.conversationId, links: [] as string[] };

    const { newlyMentioned } = await editMessageBody(tx, {
      organizationId: ctx.organizationId,
      conversationId: message.conversationId,
      messageId: id,
      editorId: ctx.principal.id,
      previousBody: message.body,
      body: input.body,
      mentionedUserIds: input.mentionedUserIds ?? [],
    });
    const links = extractLinks(input.body);
    await replaceMessageLinks(tx, ctx.organizationId, id, links);
    if (newlyMentioned.length > 0) {
      const [conversation, editorName] = await Promise.all([
        findConversationKindTx(tx, ctx.organizationId, message.conversationId),
        findUserFullName(tx, ctx.organizationId, ctx.principal.id),
      ]);
      if (conversation) await notifyMention(tx, ctx, { id: message.conversationId, ...conversation }, editorName, id, newlyMentioned);
    }
    return { changed: true, conversationId: message.conversationId, links };
  });

  const updated = await getMessage(ctx, id);
  if (result.changed) {
    await fanOutToOtherMembers(ctx, result.conversationId, 'chat:message:edited', { conversationId: result.conversationId, id });
    unfurlInBackground(ctx.organizationId, result.conversationId, id, result.links);
  }
  return updated;
}

/** What the message said before each edit, newest change first. Any member may read it. */
export async function getMessageEdits(ctx: RequestContext, id: string): Promise<MessageEdit[]> {
  const message = await findMessageRow(ctx, id);
  if (!message) throw new ChatNotFoundError('message');
  if (message.deletedAt) return [];
  return listMessageEdits(ctx, id);
}

/* ------------------------------------------------------------------ *
 * Reactions and read receipts
 * ------------------------------------------------------------------ */

export async function reactToMessage(ctx: RequestContext, id: string, emoji: ReactionEmoji): Promise<Message> {
  const message = await findMessageRow(ctx, id);
  if (!message) throw new ChatNotFoundError('message');
  if (message.deletedAt) throw new ChatValidationError('This message was unsent');

  await db.transaction(ctx, async (tx) => {
    const added = await addReaction(tx, ctx.organizationId, id, ctx.principal.id, emoji);
    if (!added) return; // already reacted with this emoji: no second notification
    const reactorName = await findUserFullName(tx, ctx.organizationId, ctx.principal.id);
    await notifyReaction(tx, ctx, message.senderId, reactorName, emoji, message.conversationId, id);
  });
  const updated = await getMessage(ctx, id);
  await fanOutToOtherMembers(ctx, message.conversationId, 'chat:message:reaction', { conversationId: message.conversationId, id, userId: ctx.principal.id, emoji });
  return updated;
}

export async function removeReactionFromMessage(ctx: RequestContext, id: string, emoji: ReactionEmoji): Promise<Message> {
  const message = await findMessageRow(ctx, id);
  if (!message) throw new ChatNotFoundError('message');

  await db.transaction(ctx, (tx) => removeReaction(tx, ctx.organizationId, id, ctx.principal.id, emoji));
  const updated = await getMessage(ctx, id);
  await fanOutToOtherMembers(ctx, message.conversationId, 'chat:message:reaction', { conversationId: message.conversationId, id, userId: ctx.principal.id, emoji, removed: true });
  return updated;
}

export async function markRead(ctx: RequestContext, conversationId: string): Promise<void> {
  await db.transaction(ctx, (tx) => markConversationRead(tx, ctx.organizationId, conversationId, ctx.principal.id));
  await fanOutToOtherMembers(ctx, conversationId, 'chat:message:read', { conversationId, userId: ctx.principal.id });
}

/* ------------------------------------------------------------------ *
 * Pins — any employee member (product decision); clients only read them
 * ------------------------------------------------------------------ */

export async function pinMessage(ctx: RequestContext, id: string): Promise<Message> {
  const message = await findMessageRow(ctx, id);
  if (!message) throw new ChatNotFoundError('message');
  if (message.deletedAt) throw new ChatValidationError('An unsent message cannot be pinned');
  const outcome = await db.transaction(ctx, (tx) => repoPinMessage(tx, {
    organizationId: ctx.organizationId,
    conversationId: message.conversationId,
    messageId: id,
    userId: ctx.principal.id,
  }));
  if (outcome === 'full') {
    throw new ChatValidationError(`A conversation can have at most ${MAX_PINS_PER_CONVERSATION} pinned messages. Unpin one first.`);
  }
  if (outcome === 'pinned') {
    await fanOutToOtherMembers(ctx, message.conversationId, 'chat:message:pinned', { conversationId: message.conversationId, id, pinned: true });
  }
  return getMessage(ctx, id);
}

export async function unpinMessage(ctx: RequestContext, id: string): Promise<Message> {
  const message = await findMessageRow(ctx, id);
  if (!message) throw new ChatNotFoundError('message');
  const removed = await db.transaction(ctx, (tx) => repoUnpinMessage(tx, ctx.organizationId, id));
  if (removed) {
    await fanOutToOtherMembers(ctx, message.conversationId, 'chat:message:pinned', { conversationId: message.conversationId, id, pinned: false });
  }
  return getMessage(ctx, id);
}

/** The conversation's pins, most recently pinned first, as full messages. */
export async function listPins(ctx: RequestContext, conversationId: string): Promise<PinnedMessage[]> {
  const pins = await listPinRows(ctx, conversationId);
  const messages = await findMessagesByIds(ctx, pins.map((pin) => pin.messageId));
  return pins.flatMap((pin) => {
    const message = messages.get(pin.messageId);
    return message ? [{ message, pinnedAt: pin.pinnedAt, pinnedBy: pin.pinnedBy, pinnedByName: pin.pinnedByName }] : [];
  });
}

/* ------------------------------------------------------------------ *
 * Saved for later — a personal tray, invisible to everyone else
 * ------------------------------------------------------------------ */

export async function saveMessage(ctx: RequestContext, id: string): Promise<Message> {
  const message = await findMessageRow(ctx, id);
  if (!message) throw new ChatNotFoundError('message');
  await db.transaction(ctx, (tx) => repoSaveMessage(tx, {
    organizationId: ctx.organizationId,
    conversationId: message.conversationId,
    messageId: id,
    userId: ctx.principal.id,
  }));
  return getMessage(ctx, id);
}

export async function unsaveMessage(ctx: RequestContext, id: string): Promise<Message> {
  const message = await findMessageRow(ctx, id);
  if (!message) throw new ChatNotFoundError('message');
  await db.transaction(ctx, (tx) => repoUnsaveMessage(tx, ctx.organizationId, id, ctx.principal.id));
  return getMessage(ctx, id);
}

export async function listSaved(ctx: RequestContext, query: { limit: number; cursor?: string | undefined }): Promise<{ items: SavedMessage[]; nextCursor: string | null }> {
  const cursor = query.cursor ? decodeMessageCursor(query.cursor) : null;
  const rows = await listSavedRows(ctx, { limit: query.limit + 1, cursor });
  const page = rows.slice(0, query.limit);
  const messages = await findMessagesByIds(ctx, page.map((row) => row.messageId));
  const items = page.flatMap((row): SavedMessage[] => {
    const message = messages.get(row.messageId);
    return message
      ? [{
          savedAt: row.savedAt,
          message,
          senderName: row.senderName,
          conversation: {
            id: row.conversationId,
            kind: row.kind,
            name: row.name,
            projectId: row.projectId,
            label: row.kind === 'direct' ? (row.otherMemberName ?? 'Direct message') : (row.name ?? 'Group'),
          },
        }]
      : [];
  });
  const last = page[page.length - 1];
  return {
    items,
    nextCursor: rows.length > query.limit && last ? encodeMessageCursor({ createdAt: last.savedAt.toISOString(), id: last.messageId }) : null,
  };
}

/** For the link-preview sweep: messages that link to a URL whose preview just became ready. */
export async function announcePreviewReady(organizationId: string, urls: readonly string[]): Promise<void> {
  if (urls.length === 0) return;
  const ctx = backgroundContext(organizationId, 'chat.link-preview-sweep', 'announce');
  const rows = await db.query<{ messageId: string; conversationId: string }>(ctx, sql`
    SELECT DISTINCT ml.message_id AS "messageId", m.conversation_id AS "conversationId"
      FROM message_link ml
      JOIN message m ON m.organization_id = ml.organization_id AND m.id = ml.message_id
     WHERE ml.organization_id = ${organizationId} AND ml.url = ANY(${[...urls]}::text[])
       AND m.created_at > now() - interval '1 day'
  `);
  for (const row of rows) {
    await fanOut(ctx, row.conversationId, 'chat:message:updated', { conversationId: row.conversationId, id: row.messageId }, true);
  }
}
