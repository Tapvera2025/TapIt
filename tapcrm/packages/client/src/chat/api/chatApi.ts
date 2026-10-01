import { identityRequest } from '../../identity/api/authApi.js';

export type ConversationKind = 'direct' | 'group' | 'project';
export const REACTION_EMOJI = ['👍', '❤️', '😂', '😮', '😢', '🙏'] as const;
export type ReactionEmoji = (typeof REACTION_EMOJI)[number];

export interface ConversationMember {
  userId: string;
  fullName: string;
  lastReadAt: string | null;
}

export interface MessagePreview {
  id: string;
  senderId: string;
  body: string | null;
  deletedAt: string | null;
  createdAt: string;
}

export interface Conversation {
  id: string;
  organizationId: string;
  kind: ConversationKind;
  name: string | null;
  description: string | null;
  projectId: string | null;
  createdBy: string;
  createdAt: string;
  members: ConversationMember[];
  lastMessage: MessagePreview | null;
  unreadCount: number;
}

export interface ChatMessage {
  id: string;
  organizationId: string;
  conversationId: string;
  senderId: string;
  body: string | null;
  replyToMessageId: string | null;
  replyPreview: MessagePreview | null;
  forwarded: boolean;
  forwardedFromSenderId: string | null;
  deletedAt: string | null;
  createdAt: string;
  reactions: { userId: string; emoji: ReactionEmoji }[];
  seenBy: string[];
  mentions: { userId: string; fullName: string }[];
}

export function getConversations(kind?: ConversationKind): Promise<Conversation[]> {
  return identityRequest(`/api/chat/conversations${kind ? `?kind=${kind}` : ''}`);
}

export function getConversation(id: string): Promise<Conversation> {
  return identityRequest(`/api/chat/conversations/${encodeURIComponent(id)}`);
}

export function getMessages(conversationId: string, options: { limit?: number; cursor?: string } = {}): Promise<{ messages: ChatMessage[]; nextCursor: string | null }> {
  const query = new URLSearchParams();
  if (options.limit) query.set('limit', String(options.limit));
  if (options.cursor) query.set('cursor', options.cursor);
  const suffix = query.toString();
  return identityRequest(`/api/chat/conversations/${encodeURIComponent(conversationId)}/messages${suffix ? `?${suffix}` : ''}`);
}

export function markConversationRead(conversationId: string): Promise<{ read: boolean }> {
  return identityRequest(`/api/chat/conversations/${encodeURIComponent(conversationId)}/read`, { method: 'POST' });
}

export function startDirectConversation(userId: string): Promise<Conversation> {
  return identityRequest('/api/chat/conversations/direct', { method: 'POST', body: JSON.stringify({ userId }) });
}

/** Everyone a DM can be started with — scoped by `chat:send`, not the HR employee directory. */
export function getChatColleagues(): Promise<{ id: string; fullName: string }[]> {
  return identityRequest('/api/chat/colleagues');
}

/** Internal Groups (Phase 3) — Super-Admin-only server-side (chat:manage-groups). */
export function createGroup(name: string, memberIds: string[], description?: string | null): Promise<Conversation> {
  return identityRequest('/api/chat/conversations/group', { method: 'POST', body: JSON.stringify({ name, memberIds, description: description ?? undefined }) });
}

export function renameGroup(conversationId: string, name: string, description?: string | null): Promise<Conversation> {
  return identityRequest(`/api/chat/conversations/${encodeURIComponent(conversationId)}`, { method: 'PATCH', body: JSON.stringify({ name, description }) });
}

export function addGroupMembers(conversationId: string, memberIds: string[]): Promise<Conversation> {
  return identityRequest(`/api/chat/conversations/${encodeURIComponent(conversationId)}/members`, { method: 'POST', body: JSON.stringify({ memberIds }) });
}

export function removeGroupMember(conversationId: string, userId: string): Promise<Conversation> {
  return identityRequest(`/api/chat/conversations/${encodeURIComponent(conversationId)}/members/${encodeURIComponent(userId)}`, { method: 'DELETE' });
}

export function archiveGroup(conversationId: string): Promise<{ archived: true }> {
  return identityRequest(`/api/chat/conversations/${encodeURIComponent(conversationId)}/archive`, { method: 'POST' });
}

export function sendMessage(conversationId: string, body: string, replyToMessageId?: string | null, mentionedUserIds?: string[]): Promise<ChatMessage> {
  return identityRequest(`/api/chat/conversations/${encodeURIComponent(conversationId)}/messages`, {
    method: 'POST',
    body: JSON.stringify({
      body,
      ...(replyToMessageId ? { replyToMessageId } : {}),
      ...(mentionedUserIds && mentionedUserIds.length > 0 ? { mentionedUserIds } : {}),
    }),
  });
}

export function forwardMessage(messageId: string, conversationId: string): Promise<ChatMessage> {
  return identityRequest(`/api/chat/messages/${encodeURIComponent(messageId)}/forward`, {
    method: 'POST',
    body: JSON.stringify({ conversationId }),
  });
}

export function reactToMessage(messageId: string, emoji: ReactionEmoji): Promise<ChatMessage> {
  return identityRequest(`/api/chat/messages/${encodeURIComponent(messageId)}/react`, { method: 'POST', body: JSON.stringify({ emoji }) });
}

export function removeReaction(messageId: string, emoji: ReactionEmoji): Promise<ChatMessage> {
  return identityRequest(`/api/chat/messages/${encodeURIComponent(messageId)}/react`, { method: 'DELETE', body: JSON.stringify({ emoji }) });
}

export function unsendMessage(messageId: string): Promise<ChatMessage> {
  return identityRequest(`/api/chat/messages/${encodeURIComponent(messageId)}/unsend`, { method: 'POST' });
}
