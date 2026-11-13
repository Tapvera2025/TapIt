import {
  cancelScheduledMessage,
  deletePendingAttachment,
  editMessage,
  forwardMessage,
  getMessageEdits,
  getPins,
  getScheduledMessages,
  pinMessage,
  reactToMessage,
  removeReaction,
  saveMessage,
  scheduleMessage,
  sendMessage,
  sendScheduledNow,
  unpinMessage,
  unsaveMessage,
  unsendMessage,
  updateScheduledMessage,
  uploadAttachment,
  type ChatMessage,
  type MessageAttachment,
  type MessageEdit,
  type OutgoingMessage,
  type PinnedMessage,
  type ReactionEmoji,
  type ScheduledMessage,
} from './api/chatApi.js';

/**
 * What a conversation screen can do, and how. The company Messages module
 * and the client portal render the same ConversationWorkspace; they differ
 * in the endpoints behind each action and in which actions exist at all.
 *
 * Client portal "core set" (product decision): send with files, react with
 * any emoji, edit their own messages, read pins. Forward, unsend, pin,
 * save, schedule, search and presence are employee-only and are simply
 * absent from the client transport.
 */
export interface ChatTransport {
  readonly sendMessage: (conversationId: string, input: OutgoingMessage) => Promise<ChatMessage>;
  readonly editMessage: (conversationId: string, messageId: string, body: string, mentionedUserIds: string[]) => Promise<ChatMessage>;
  readonly getMessageEdits: (conversationId: string, messageId: string) => Promise<MessageEdit[]>;
  readonly reactToMessage: (conversationId: string, messageId: string, emoji: ReactionEmoji) => Promise<ChatMessage>;
  readonly removeReaction: (conversationId: string, messageId: string, emoji: ReactionEmoji) => Promise<ChatMessage>;
  readonly uploadAttachment: (conversationId: string, file: File, onProgress: (fraction: number) => void, signal: AbortSignal) => Promise<MessageAttachment>;
  readonly deletePendingAttachment: (conversationId: string, attachmentId: string) => Promise<unknown>;
  readonly getPins: (conversationId: string) => Promise<PinnedMessage[]>;
  readonly forwardMessage?: (messageId: string, targetConversationId: string) => Promise<ChatMessage>;
  readonly unsendMessage?: (messageId: string) => Promise<ChatMessage>;
  readonly pinMessage?: (messageId: string) => Promise<ChatMessage>;
  readonly unpinMessage?: (messageId: string) => Promise<ChatMessage>;
  readonly saveMessage?: (messageId: string) => Promise<ChatMessage>;
  readonly unsaveMessage?: (messageId: string) => Promise<ChatMessage>;
  readonly scheduleMessage?: (conversationId: string, input: OutgoingMessage & { sendAt: string }) => Promise<ScheduledMessage>;
  readonly getScheduledMessages?: (conversationId: string) => Promise<ScheduledMessage[]>;
  readonly updateScheduledMessage?: (id: string, input: { body?: string; sendAt?: string }) => Promise<ScheduledMessage>;
  readonly cancelScheduledMessage?: (id: string) => Promise<unknown>;
  readonly sendScheduledNow?: (id: string) => Promise<{ sent: boolean; messageId: string | null; failureReason: string | null }>;
  /** Show live-status presence dots (employees only). */
  readonly presence: boolean;
}

export const companyChatTransport: ChatTransport = {
  sendMessage: (conversationId, input) => sendMessage(conversationId, input.body, input.replyToMessageId ?? null, input.mentionedUserIds ?? [], input.attachmentIds ?? []),
  editMessage: (_conversationId, messageId, body, mentionedUserIds) => editMessage(messageId, body, mentionedUserIds),
  getMessageEdits: (_conversationId, messageId) => getMessageEdits(messageId),
  reactToMessage: (_conversationId, messageId, emoji) => reactToMessage(messageId, emoji),
  removeReaction: (_conversationId, messageId, emoji) => removeReaction(messageId, emoji),
  uploadAttachment: (conversationId, file, onProgress, signal) => uploadAttachment(conversationId, file, onProgress, signal),
  deletePendingAttachment: (_conversationId, attachmentId) => deletePendingAttachment(attachmentId),
  getPins,
  forwardMessage,
  unsendMessage,
  pinMessage,
  unpinMessage,
  saveMessage,
  unsaveMessage,
  scheduleMessage,
  getScheduledMessages,
  updateScheduledMessage,
  cancelScheduledMessage,
  sendScheduledNow,
  presence: true,
};
