import { identityRequest } from '../../identity/api/authApi.js';
import {
  uploadFile,
  type ChatMessage,
  type Conversation,
  type MessageAttachment,
  type MessageEdit,
  type MessagePage,
  type OutgoingMessage,
  type PinnedMessage,
  type ReactionEmoji,
} from '../../chat/api/chatApi.js';

export interface ProjectDiscussion { currentUserId: string; conversation: Conversation | null }
export interface ClientProjectDiscussions {
  currentUserId: string;
  discussions: { projectId: string; projectName: string; conversation: Conversation }[];
}
const enc = encodeURIComponent;
const root = (projectId: string, conversationId?: string) =>
  `/api/client-portal/projects/${enc(projectId)}/discussion${conversationId ? `/${enc(conversationId)}` : ''}`;

export const getProjectDiscussion = (projectId: string) => identityRequest<ProjectDiscussion>(root(projectId));
export const listClientProjectDiscussions = () => identityRequest<ClientProjectDiscussions>('/api/client-portal/discussions');
export const getProjectDiscussionMessages = (projectId: string, conversationId: string, options: { limit?: number; cursor?: string; after?: string; around?: string } = {}) => {
  const query = new URLSearchParams();
  if (options.limit) query.set('limit', String(options.limit));
  if (options.cursor) query.set('cursor', options.cursor);
  if (options.after) query.set('after', options.after);
  if (options.around) query.set('around', options.around);
  const suffix = query.toString();
  return identityRequest<MessagePage>(`${root(projectId, conversationId)}/messages${suffix ? `?${suffix}` : ''}`);
};
export const getProjectDiscussionMessage = (projectId: string, conversationId: string, messageId: string) =>
  identityRequest<ChatMessage>(`${root(projectId, conversationId)}/messages/${enc(messageId)}`);
export const markProjectDiscussionRead = (projectId: string, conversationId: string) =>
  identityRequest<{ read: boolean }>(`${root(projectId, conversationId)}/read`, { method: 'POST' });
export const sendProjectDiscussionMessage = (projectId: string, conversationId: string, input: OutgoingMessage) =>
  identityRequest<ChatMessage>(`${root(projectId, conversationId)}/messages`, {
    method: 'POST',
    body: JSON.stringify({
      body: input.body,
      ...(input.replyToMessageId ? { replyToMessageId: input.replyToMessageId } : {}),
      ...(input.mentionedUserIds?.length ? { mentionedUserIds: input.mentionedUserIds } : {}),
      ...(input.attachmentIds?.length ? { attachmentIds: input.attachmentIds } : {}),
    }),
  });
export const editProjectDiscussionMessage = (projectId: string, conversationId: string, messageId: string, body: string, mentionedUserIds: string[]) =>
  identityRequest<ChatMessage>(`${root(projectId, conversationId)}/messages/${enc(messageId)}`, { method: 'PATCH', body: JSON.stringify({ body, mentionedUserIds }) });
export const getProjectDiscussionMessageEdits = (projectId: string, conversationId: string, messageId: string) =>
  identityRequest<MessageEdit[]>(`${root(projectId, conversationId)}/messages/${enc(messageId)}/edits`);
export const getProjectDiscussionPins = (projectId: string, conversationId: string) =>
  identityRequest<PinnedMessage[]>(`${root(projectId, conversationId)}/pins`);
export const reactToProjectDiscussionMessage = (projectId: string, conversationId: string, messageId: string, emoji: ReactionEmoji) =>
  identityRequest<ChatMessage>(`${root(projectId, conversationId)}/messages/${enc(messageId)}/react`, { method: 'POST', body: JSON.stringify({ emoji }) });
export const removeProjectDiscussionReaction = (projectId: string, conversationId: string, messageId: string, emoji: ReactionEmoji) =>
  identityRequest<ChatMessage>(`${root(projectId, conversationId)}/messages/${enc(messageId)}/react`, { method: 'DELETE', body: JSON.stringify({ emoji }) });
export const uploadProjectDiscussionAttachment = (projectId: string, conversationId: string, file: File, onProgress?: (fraction: number) => void, signal?: AbortSignal): Promise<MessageAttachment> =>
  uploadFile(`${root(projectId, conversationId)}/attachments`, file, onProgress, signal);
export const deleteProjectDiscussionAttachment = (projectId: string, conversationId: string, attachmentId: string) =>
  identityRequest<{ deleted: true }>(`${root(projectId, conversationId)}/attachments/${enc(attachmentId)}`, { method: 'DELETE' });
