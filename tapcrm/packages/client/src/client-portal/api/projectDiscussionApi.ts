import { identityRequest } from '../../identity/api/authApi.js';
import type { ChatMessage, Conversation, ReactionEmoji } from '../../chat/api/chatApi.js';

export interface ProjectDiscussion { currentUserId: string; conversation: Conversation | null }
export interface ClientProjectDiscussions {
  currentUserId: string;
  discussions: { projectId: string; projectName: string; conversation: Conversation }[];
}
const root = (projectId: string, conversationId?: string) =>
  `/api/client-portal/projects/${encodeURIComponent(projectId)}/discussion${conversationId ? `/${encodeURIComponent(conversationId)}` : ''}`;

export const getProjectDiscussion = (projectId: string) => identityRequest<ProjectDiscussion>(root(projectId));
export const listClientProjectDiscussions = () => identityRequest<ClientProjectDiscussions>('/api/client-portal/discussions');
export const getProjectDiscussionMessages = (projectId: string, conversationId: string, options: { limit?: number; cursor?: string } = {}) => {
  const query = new URLSearchParams();
  if (options.limit) query.set('limit', String(options.limit));
  if (options.cursor) query.set('cursor', options.cursor);
  const suffix = query.toString();
  return identityRequest<{ messages: ChatMessage[]; nextCursor: string | null }>(`${root(projectId, conversationId)}/messages${suffix ? `?${suffix}` : ''}`);
};
export const markProjectDiscussionRead = (projectId: string, conversationId: string) =>
  identityRequest<{ read: boolean }>(`${root(projectId, conversationId)}/read`, { method: 'POST' });
export const sendProjectDiscussionMessage = (projectId: string, conversationId: string, body: string, replyToMessageId?: string | null, mentionedUserIds?: string[]) =>
  identityRequest<ChatMessage>(`${root(projectId, conversationId)}/messages`, {
    method: 'POST', body: JSON.stringify({ body, ...(replyToMessageId ? { replyToMessageId } : {}), ...(mentionedUserIds?.length ? { mentionedUserIds } : {}) }),
  });
export const reactToProjectDiscussionMessage = (projectId: string, conversationId: string, messageId: string, emoji: ReactionEmoji) =>
  identityRequest<ChatMessage>(`${root(projectId, conversationId)}/messages/${encodeURIComponent(messageId)}/react`, { method: 'POST', body: JSON.stringify({ emoji }) });
export const removeProjectDiscussionReaction = (projectId: string, conversationId: string, messageId: string, emoji: ReactionEmoji) =>
  identityRequest<ChatMessage>(`${root(projectId, conversationId)}/messages/${encodeURIComponent(messageId)}/react`, { method: 'DELETE', body: JSON.stringify({ emoji }) });
