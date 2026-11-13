import { getIdentityAccessToken, identityApiPath, identityRequest, IdentityApiError } from '../../identity/api/authApi.js';

export type ConversationKind = 'direct' | 'group' | 'project';
export interface ChatUnreadSummary {
  total: number;
  direct: number;
  group: number;
  project: number;
}
/** The quick-reaction bar. Any single emoji is accepted; the full picker offers the rest. */
export const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'] as const;
/** @deprecated reactions are no longer limited to this set — kept for older imports. */
export const REACTION_EMOJI = QUICK_REACTIONS;
export type ReactionEmoji = string;

export type AttachmentKind = 'image' | 'pdf' | 'document' | 'spreadsheet' | 'presentation' | 'text' | 'archive';
export type ChatPresence = 'active' | 'idle' | 'offline';

/** A member's part in an Internal Group; the creator is `Conversation.createdBy`, not a role. */
export type GroupMemberRole = 'member' | 'admin';

export interface ConversationMember {
  userId: string;
  fullName: string;
  lastReadAt: string | null;
  role?: GroupMemberRole;
}

export interface MessagePreview {
  id: string;
  senderId: string;
  body: string | null;
  deletedAt: string | null;
  createdAt: string;
  attachmentCount?: number;
  firstAttachment?: { kind: AttachmentKind; fileName: string } | null;
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
  /** Set once archived: read-only, listed under "Archived". */
  archivedAt?: string | null;
  members: ConversationMember[];
  lastMessage: MessagePreview | null;
  unreadCount: number;
  pinnedCount?: number;
}

export interface MessageAttachment {
  id: string;
  kind: AttachmentKind;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  pageCount: number | null;
  url: string;
  downloadUrl: string;
  thumbnailUrl: string | null;
}

export interface LinkPreview {
  url: string;
  title: string | null;
  description: string | null;
  siteName: string | null;
  provider: string | null;
  imageUrl: string | null;
  imageWidth: number | null;
  imageHeight: number | null;
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
  editedAt?: string | null;
  reactions: { userId: string; emoji: ReactionEmoji }[];
  seenBy: string[];
  mentions: { userId: string; fullName: string }[];
  attachments?: MessageAttachment[];
  linkPreviews?: LinkPreview[];
  pinnedAt?: string | null;
  pinnedBy?: string | null;
  saved?: boolean;
}

export interface MessagePage {
  messages: ChatMessage[];
  nextCursor: string | null;
  newerCursor?: string | null;
}

export interface MessageEdit {
  id: string;
  previousBody: string;
  editedBy: string;
  editedAt: string;
}

export interface PinnedMessage {
  message: ChatMessage;
  pinnedAt: string;
  pinnedBy: string;
  pinnedByName: string;
}

export interface SavedMessage {
  savedAt: string;
  message: ChatMessage;
  conversation: { id: string; kind: ConversationKind; name: string | null; projectId: string | null; label: string };
  senderName: string;
}

export interface SearchResult {
  messageId: string;
  conversationId: string;
  conversationKind: ConversationKind;
  conversationLabel: string;
  senderId: string;
  senderName: string;
  createdAt: string;
  editedAt: string | null;
  /** ⟦ and ⟧ mark highlighted terms. */
  snippet: string;
  attachments: { id: string; kind: AttachmentKind; fileName: string }[];
  hasLinks: boolean;
}

export type SearchType = 'image' | 'pdf' | 'document' | 'spreadsheet' | 'presentation' | 'file' | 'link';

export interface SearchFilters {
  q?: string | undefined;
  conversationId?: string | undefined;
  senderId?: string | undefined;
  /** ISO timestamps. */
  from?: string | undefined;
  to?: string | undefined;
  type?: SearchType | undefined;
  cursor?: string | undefined;
  limit?: number | undefined;
}

export interface ScheduledMessage {
  id: string;
  conversationId: string;
  body: string;
  replyToMessageId: string | null;
  mentionedUserIds: string[];
  sendAt: string;
  status: 'pending' | 'sent' | 'cancelled' | 'failed';
  sentMessageId: string | null;
  failureReason: string | null;
  createdAt: string;
  attachments: MessageAttachment[];
}

export interface OutgoingMessage {
  body: string;
  replyToMessageId?: string | null;
  mentionedUserIds?: string[];
  attachmentIds?: string[];
}

const enc = encodeURIComponent;

function messageBody(input: OutgoingMessage): string {
  return JSON.stringify({
    body: input.body,
    ...(input.replyToMessageId ? { replyToMessageId: input.replyToMessageId } : {}),
    ...(input.mentionedUserIds && input.mentionedUserIds.length > 0 ? { mentionedUserIds: input.mentionedUserIds } : {}),
    ...(input.attachmentIds && input.attachmentIds.length > 0 ? { attachmentIds: input.attachmentIds } : {}),
  });
}

function pageQuery(options: { limit?: number; cursor?: string; after?: string; around?: string }): string {
  const query = new URLSearchParams();
  if (options.limit) query.set('limit', String(options.limit));
  if (options.cursor) query.set('cursor', options.cursor);
  if (options.after) query.set('after', options.after);
  if (options.around) query.set('around', options.around);
  const suffix = query.toString();
  return suffix ? `?${suffix}` : '';
}

export function getConversations(kind?: ConversationKind, options: { archived?: boolean } = {}): Promise<Conversation[]> {
  const query = new URLSearchParams();
  if (kind) query.set('kind', kind);
  if (options.archived) query.set('archived', 'true');
  const suffix = query.toString();
  return identityRequest(`/api/chat/conversations${suffix ? `?${suffix}` : ''}`);
}

export function getChatUnreadSummary(): Promise<ChatUnreadSummary> {
  return identityRequest('/api/chat/unread-summary');
}

export function getConversation(id: string): Promise<Conversation> {
  return identityRequest(`/api/chat/conversations/${enc(id)}`);
}

export function getMessages(conversationId: string, options: { limit?: number; cursor?: string; after?: string; around?: string } = {}): Promise<MessagePage> {
  return identityRequest(`/api/chat/conversations/${enc(conversationId)}/messages${pageQuery(options)}`);
}

export function getMessage(messageId: string): Promise<ChatMessage> {
  return identityRequest(`/api/chat/messages/${enc(messageId)}`);
}

export function markConversationRead(conversationId: string): Promise<{ read: boolean }> {
  return identityRequest(`/api/chat/conversations/${enc(conversationId)}/read`, { method: 'POST' });
}

export function startDirectConversation(userId: string): Promise<Conversation> {
  return identityRequest('/api/chat/conversations/direct', { method: 'POST', body: JSON.stringify({ userId }) });
}

/** Everyone a DM can be started with — scoped by `chat:send`, not the HR employee directory. */
export function getChatColleagues(): Promise<{ id: string; fullName: string }[]> {
  return identityRequest('/api/chat/colleagues');
}

/**
 * Internal Groups. Creating one is Super-Admin-only. Editing it and adding or
 * removing members is open to its creator and its admins; making admins,
 * archiving, restoring and deleting are for the creator (or a Super Admin).
 */
export function createGroup(name: string, memberIds: string[], description?: string | null): Promise<Conversation> {
  return identityRequest('/api/chat/conversations/group', { method: 'POST', body: JSON.stringify({ name, memberIds, description: description ?? undefined }) });
}

export function renameGroup(conversationId: string, name: string, description?: string | null): Promise<Conversation> {
  return identityRequest(`/api/chat/conversations/${enc(conversationId)}`, { method: 'PATCH', body: JSON.stringify({ name, description }) });
}

export function addGroupMembers(conversationId: string, memberIds: string[]): Promise<Conversation> {
  return identityRequest(`/api/chat/conversations/${enc(conversationId)}/members`, { method: 'POST', body: JSON.stringify({ memberIds }) });
}

export function removeGroupMember(conversationId: string, userId: string): Promise<Conversation> {
  return identityRequest(`/api/chat/conversations/${enc(conversationId)}/members/${enc(userId)}`, { method: 'DELETE' });
}

export function archiveGroup(conversationId: string): Promise<{ archived: true }> {
  return identityRequest(`/api/chat/conversations/${enc(conversationId)}/archive`, { method: 'POST' });
}

export function setGroupMemberRole(conversationId: string, userId: string, role: GroupMemberRole): Promise<Conversation> {
  return identityRequest(`/api/chat/conversations/${enc(conversationId)}/members/${enc(userId)}/role`, {
    method: 'PUT',
    body: JSON.stringify({ role }),
  });
}

export function restoreGroup(conversationId: string): Promise<Conversation> {
  return identityRequest(`/api/chat/conversations/${enc(conversationId)}/restore`, { method: 'POST' });
}

/** Removes the group for everyone; its messages are kept on record server-side. */
export function deleteGroup(conversationId: string): Promise<{ deleted: true }> {
  return identityRequest(`/api/chat/conversations/${enc(conversationId)}`, { method: 'DELETE' });
}

/** Older call shape kept for compatibility; new code passes an OutgoingMessage. */
export function sendMessage(conversationId: string, body: string, replyToMessageId?: string | null, mentionedUserIds?: string[], attachmentIds?: string[]): Promise<ChatMessage> {
  return identityRequest(`/api/chat/conversations/${enc(conversationId)}/messages`, {
    method: 'POST',
    body: messageBody({ body, replyToMessageId: replyToMessageId ?? null, mentionedUserIds: mentionedUserIds ?? [], attachmentIds: attachmentIds ?? [] }),
  });
}

export function editMessage(messageId: string, body: string, mentionedUserIds: string[] = []): Promise<ChatMessage> {
  return identityRequest(`/api/chat/messages/${enc(messageId)}`, { method: 'PATCH', body: JSON.stringify({ body, mentionedUserIds }) });
}

export function getMessageEdits(messageId: string): Promise<MessageEdit[]> {
  return identityRequest(`/api/chat/messages/${enc(messageId)}/edits`);
}

export function forwardMessage(messageId: string, conversationId: string): Promise<ChatMessage> {
  return identityRequest(`/api/chat/messages/${enc(messageId)}/forward`, {
    method: 'POST',
    body: JSON.stringify({ conversationId }),
  });
}

export function reactToMessage(messageId: string, emoji: ReactionEmoji): Promise<ChatMessage> {
  return identityRequest(`/api/chat/messages/${enc(messageId)}/react`, { method: 'POST', body: JSON.stringify({ emoji }) });
}

export function removeReaction(messageId: string, emoji: ReactionEmoji): Promise<ChatMessage> {
  return identityRequest(`/api/chat/messages/${enc(messageId)}/react`, { method: 'DELETE', body: JSON.stringify({ emoji }) });
}

export function unsendMessage(messageId: string): Promise<ChatMessage> {
  return identityRequest(`/api/chat/messages/${enc(messageId)}/unsend`, { method: 'POST' });
}

export function pinMessage(messageId: string): Promise<ChatMessage> {
  return identityRequest(`/api/chat/messages/${enc(messageId)}/pin`, { method: 'POST' });
}

export function unpinMessage(messageId: string): Promise<ChatMessage> {
  return identityRequest(`/api/chat/messages/${enc(messageId)}/pin`, { method: 'DELETE' });
}

export function getPins(conversationId: string): Promise<PinnedMessage[]> {
  return identityRequest(`/api/chat/conversations/${enc(conversationId)}/pins`);
}

export function saveMessage(messageId: string): Promise<ChatMessage> {
  return identityRequest(`/api/chat/messages/${enc(messageId)}/save`, { method: 'POST' });
}

export function unsaveMessage(messageId: string): Promise<ChatMessage> {
  return identityRequest(`/api/chat/messages/${enc(messageId)}/save`, { method: 'DELETE' });
}

export function getSavedMessages(options: { cursor?: string; limit?: number } = {}): Promise<{ items: SavedMessage[]; nextCursor: string | null }> {
  return identityRequest(`/api/chat/saved${pageQuery(options)}`);
}

export function searchMessages(filters: SearchFilters): Promise<{ results: SearchResult[]; nextCursor: string | null }> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== null && String(value).length > 0) query.set(key, String(value));
  }
  return identityRequest(`/api/chat/search?${query.toString()}`);
}

export function getPresence(): Promise<Record<string, ChatPresence>> {
  return identityRequest('/api/chat/presence');
}

export function scheduleMessage(conversationId: string, input: OutgoingMessage & { sendAt: string }): Promise<ScheduledMessage> {
  const body = JSON.parse(messageBody(input)) as Record<string, unknown>;
  return identityRequest(`/api/chat/conversations/${enc(conversationId)}/scheduled`, {
    method: 'POST',
    body: JSON.stringify({ ...body, sendAt: input.sendAt }),
  });
}

export function getScheduledMessages(conversationId?: string): Promise<ScheduledMessage[]> {
  return identityRequest(`/api/chat/scheduled${conversationId ? `?conversationId=${enc(conversationId)}` : ''}`);
}

export function updateScheduledMessage(id: string, input: { body?: string; sendAt?: string; mentionedUserIds?: string[] }): Promise<ScheduledMessage> {
  return identityRequest(`/api/chat/scheduled/${enc(id)}`, { method: 'PATCH', body: JSON.stringify(input) });
}

export function cancelScheduledMessage(id: string): Promise<{ cancelled: true }> {
  return identityRequest(`/api/chat/scheduled/${enc(id)}`, { method: 'DELETE' });
}

export function sendScheduledNow(id: string): Promise<{ sent: boolean; messageId: string | null; failureReason: string | null }> {
  return identityRequest(`/api/chat/scheduled/${enc(id)}/send-now`, { method: 'POST' });
}

/* ------------------------------------------------------------------ *
 * Uploads
 * ------------------------------------------------------------------ */

/** Mirrors the server's allow-list (modules/chat/file-types.ts) for the file picker. */
export const ATTACHMENT_ACCEPT = [
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.pdf', '.doc', '.docx', '.odt', '.rtf', '.txt', '.log', '.md', '.json',
  '.xls', '.xlsx', '.ods', '.csv', '.tsv', '.ppt', '.pptx', '.odp', '.zip',
].join(',');
export const MAX_ATTACHMENT_MB = 25;
export const MAX_ATTACHMENTS_PER_MESSAGE = 10;

/**
 * Raw-bytes upload with progress (XHR, because fetch cannot report upload
 * progress). On an expired token it falls back to one authenticated request
 * through identityRequest, which refreshes the session first.
 */
export function uploadFile(path: string, file: File, onProgress?: (fraction: number) => void, signal?: AbortSignal): Promise<MessageAttachment> {
  const send = (token: string): Promise<{ status: number; body: unknown }> => new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', identityApiPath(path));
    xhr.setRequestHeader('authorization', `Bearer ${token}`);
    xhr.setRequestHeader('content-type', 'application/octet-stream');
    xhr.setRequestHeader('x-file-name', encodeURIComponent(file.name));
    xhr.responseType = 'json';
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded / event.total);
    };
    xhr.onload = () => resolve({ status: xhr.status, body: xhr.response as unknown });
    xhr.onerror = () => reject(new IdentityApiError('Upload failed. Check your connection and try again.', 'UPLOAD_FAILED', 0));
    xhr.onabort = () => reject(new DOMException('Upload cancelled', 'AbortError'));
    signal?.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(file);
  });

  return (async () => {
    const token = getIdentityAccessToken();
    if (token) {
      const response = await send(token);
      const envelope = response.body as { success?: boolean; data?: MessageAttachment; message?: string; code?: string } | null;
      if (response.status !== 401) {
        if (response.status >= 200 && response.status < 300 && envelope?.success && envelope.data) return envelope.data;
        throw new IdentityApiError(envelope?.message ?? `Upload failed (${response.status})`, envelope?.code ?? 'UPLOAD_FAILED', response.status);
      }
    }
    // Session refresh path (rare): identityRequest renews the token and retries.
    return identityRequest<MessageAttachment>(path, {
      method: 'POST',
      body: file,
      headers: { 'content-type': 'application/octet-stream', 'x-file-name': encodeURIComponent(file.name) },
      ...(signal ? { signal } : {}),
    });
  })();
}

export function uploadAttachment(conversationId: string, file: File, onProgress?: (fraction: number) => void, signal?: AbortSignal): Promise<MessageAttachment> {
  return uploadFile(`/api/chat/conversations/${enc(conversationId)}/attachments`, file, onProgress, signal);
}

export function deletePendingAttachment(attachmentId: string): Promise<{ deleted: true }> {
  return identityRequest(`/api/chat/attachments/${enc(attachmentId)}`, { method: 'DELETE' });
}
