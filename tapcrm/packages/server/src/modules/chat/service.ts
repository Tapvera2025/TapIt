import type { Resource } from '@tapcrm/authz';
import type { Principal } from '@tapcrm/contracts';
import { createJobContext, type RequestContext } from '../../platform/dal/context.js';
import { db } from '../../platform/dal/db.js';
import { emitToUser, installTypingAuthorizer } from '../../platform/realtime/index.js';
import { ChatNotFoundError, ChatNotSenderError, ChatValidationError } from './errors.js';
import {
  addConversationMembers,
  addReaction,
  archiveConversation,
  conversationMemberIds,
  conversationMemberIdsTx,
  createGroupConversation,
  decodeMessageCursor,
  encodeMessageCursor,
  findConversationById,
  findConversationKind,
  findConversationKindTx,
  findMessageById,
  findOrCreateDirectConversation,
  findUserFullName,
  insertMessage,
  listColleagues as repoListColleagues,
  listConversationsForUser,
  listMessages as repoListMessages,
  markConversationRead,
  removeConversationMember,
  removeReaction,
  renameConversation,
  unsendMessage as repoUnsendMessage,
  validateMemberIds,
} from './repository.js';
import { notifyGroupMemberRemoved, notifyGroupMembersAdded, notifyMention, notifyNewMessage, notifyReaction } from './notifications.js';
import type { Conversation, ConversationKind, ConversationResource, Message, ReactionEmoji } from './types.js';
import type { ListMessagesQuery } from './validators.js';

export { createProjectConversation } from './facade.js';

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

/** Called once at boot — wires the typing relay to conversation membership. */
export function registerChatRealtime(): void {
  installTypingAuthorizer(async (organizationId, userId, conversationId) => {
    const ctx = createJobContext({
      organizationId,
      principal: relayPrincipal(organizationId),
      jobName: 'chat-typing-relay',
      runId: 'socket',
    });
    const ids = await conversationMemberIds(ctx, conversationId);
    if (!ids || !ids.includes(userId)) return null;
    return ids;
  });
}

function toResource(conversationId: string, organizationId: string, memberIds: readonly string[]): ConversationResource {
  return { type: 'chatConversation', id: conversationId, organizationId, memberIds };
}

/** For routes bound with `resourceParam: 'id'` naming a CONVERSATION id. */
export async function loadConversationResource(ctx: RequestContext, id: string): Promise<Resource | null> {
  const memberIds = await conversationMemberIds(ctx, id);
  if (memberIds === null) return null;
  return toResource(id, ctx.organizationId, memberIds);
}

/** For routes bound with `resourceParam: 'id'` naming a MESSAGE id — resolves to its conversation. */
export async function loadMessageResource(ctx: RequestContext, id: string): Promise<Resource | null> {
  const message = await findMessageById(ctx, id);
  if (!message) return null;
  const memberIds = await conversationMemberIds(ctx, message.conversationId);
  if (memberIds === null) return null;
  return toResource(message.conversationId, ctx.organizationId, memberIds);
}

export async function listConversations(ctx: RequestContext, kind?: ConversationKind): Promise<Conversation[]> {
  return listConversationsForUser(ctx, kind);
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
    const [valid] = await validateMemberIds(tx, ctx.organizationId, [otherUserId]);
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
    const validIds = await validateMemberIds(tx, ctx.organizationId, input.memberIds);
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
    const validIds = await validateMemberIds(tx, ctx.organizationId, memberIds);
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

export async function listMessages(ctx: RequestContext, conversationId: string, query: ListMessagesQuery): Promise<{ messages: Message[]; nextCursor: string | null }> {
  const cursor = query.cursor ? decodeMessageCursor(query.cursor) : null;
  const rows = await repoListMessages(ctx, conversationId, { limit: query.limit + 1, cursor });
  const messages = rows.slice(0, query.limit);
  const last = messages[messages.length - 1];
  return { messages, nextCursor: rows.length > query.limit && last ? encodeMessageCursor({ createdAt: last.createdAt.toISOString(), id: last.id }) : null };
}

async function fanOutToOtherMembers(ctx: RequestContext, conversationId: string, event: Parameters<typeof emitToUser>[2], payload: Record<string, unknown>): Promise<void> {
  const memberIds = await conversationMemberIds(ctx, conversationId);
  for (const memberId of memberIds ?? []) {
    if (memberId === ctx.principal.id) continue;
    emitToUser(ctx.organizationId, memberId, event, payload);
  }
}

export async function sendMessage(ctx: RequestContext, conversationId: string, input: { body: string; replyToMessageId?: string | null | undefined; mentionedUserIds?: readonly string[] | undefined }): Promise<Message> {
  if (input.replyToMessageId) {
    const target = await findMessageById(ctx, input.replyToMessageId);
    if (!target || target.conversationId !== conversationId) {
      throw new ChatValidationError('The message you are replying to is not in this conversation');
    }
  }

  const created = await db.transaction(ctx, async (tx) => {
    const inserted = await insertMessage(tx, ctx.organizationId, ctx.principal.id, conversationId, {
      body: input.body,
      replyToMessageId: input.replyToMessageId ?? null,
      mentionedUserIds: input.mentionedUserIds,
    });
    const [conversation, senderName, memberIds] = await Promise.all([
      findConversationKindTx(tx, ctx.organizationId, conversationId),
      findUserFullName(tx, ctx.organizationId, ctx.principal.id),
      conversationMemberIdsTx(tx, ctx.organizationId, conversationId),
    ]);
    if (conversation) {
      await notifyNewMessage(tx, ctx, { id: conversationId, ...conversation }, senderName, input.body, inserted.id, memberIds);
      const mentioned = (input.mentionedUserIds ?? []).filter((id) => memberIds.includes(id));
      if (mentioned.length > 0) {
        await notifyMention(tx, ctx, { id: conversationId, ...conversation }, senderName, inserted.id, mentioned);
      }
    }
    return inserted;
  });

  const message = await findMessageById(ctx, created.id);
  if (!message) throw new ChatNotFoundError('message');
  await fanOutToOtherMembers(ctx, conversationId, 'chat:message:new', { conversationId, id: message.id });
  return message;
}

/** Copies the content into a conversation you belong to; the original may later be unsent without touching this copy. */
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

  const created = await db.transaction(ctx, async (tx) => {
    const inserted = await insertMessage(tx, ctx.organizationId, ctx.principal.id, targetConversationId, {
      body: source.body!,
      forwarded: true,
      forwardedFromSenderId: source.senderId,
    });
    const [conversation, senderName, memberIds] = await Promise.all([
      findConversationKindTx(tx, ctx.organizationId, targetConversationId),
      findUserFullName(tx, ctx.organizationId, ctx.principal.id),
      conversationMemberIdsTx(tx, ctx.organizationId, targetConversationId),
    ]);
    if (conversation) await notifyNewMessage(tx, ctx, { id: targetConversationId, ...conversation }, senderName, source.body!, inserted.id, memberIds);
    return inserted;
  });

  const message = await findMessageById(ctx, created.id);
  if (!message) throw new ChatNotFoundError('message');
  await fanOutToOtherMembers(ctx, targetConversationId, 'chat:message:new', { conversationId: targetConversationId, id: message.id });
  return message;
}

/** Tombstone, not a hard delete (product decision): body cleared, the row and its timestamp remain. */
export async function unsendMessage(ctx: RequestContext, id: string): Promise<Message> {
  const message = await findMessageById(ctx, id);
  if (!message) throw new ChatNotFoundError('message');
  if (message.senderId !== ctx.principal.id) throw new ChatNotSenderError();
  if (message.deletedAt) return message; // already unsent: idempotent, not an error

  await db.transaction(ctx, (tx) => repoUnsendMessage(tx, ctx.organizationId, id, ctx.principal.id));
  const updated = await findMessageById(ctx, id);
  if (!updated) throw new ChatNotFoundError('message');
  await fanOutToOtherMembers(ctx, message.conversationId, 'chat:message:unsent', { conversationId: message.conversationId, id });
  return updated;
}

export async function reactToMessage(ctx: RequestContext, id: string, emoji: ReactionEmoji): Promise<Message> {
  const message = await findMessageById(ctx, id);
  if (!message) throw new ChatNotFoundError('message');
  if (message.deletedAt) throw new ChatValidationError('This message was unsent');

  await db.transaction(ctx, async (tx) => {
    await addReaction(tx, ctx.organizationId, id, ctx.principal.id, emoji);
    const reactorName = await findUserFullName(tx, ctx.organizationId, ctx.principal.id);
    await notifyReaction(tx, ctx, message.senderId, reactorName, emoji, message.conversationId, id);
  });
  const updated = await findMessageById(ctx, id);
  if (!updated) throw new ChatNotFoundError('message');
  await fanOutToOtherMembers(ctx, message.conversationId, 'chat:message:reaction', { conversationId: message.conversationId, id, userId: ctx.principal.id, emoji });
  return updated;
}

export async function removeReactionFromMessage(ctx: RequestContext, id: string, emoji: ReactionEmoji): Promise<Message> {
  const message = await findMessageById(ctx, id);
  if (!message) throw new ChatNotFoundError('message');

  await db.transaction(ctx, (tx) => removeReaction(tx, ctx.organizationId, id, ctx.principal.id, emoji));
  const updated = await findMessageById(ctx, id);
  if (!updated) throw new ChatNotFoundError('message');
  await fanOutToOtherMembers(ctx, message.conversationId, 'chat:message:reaction', { conversationId: message.conversationId, id, userId: ctx.principal.id, emoji, removed: true });
  return updated;
}

export async function markRead(ctx: RequestContext, conversationId: string): Promise<void> {
  await db.transaction(ctx, (tx) => markConversationRead(tx, ctx.organizationId, conversationId, ctx.principal.id));
  await fanOutToOtherMembers(ctx, conversationId, 'chat:message:read', { conversationId, userId: ctx.principal.id });
}
