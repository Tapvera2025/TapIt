import { z } from 'zod';
import { MAX_ATTACHMENTS_PER_MESSAGE } from './attachments.js';
import { isSingleEmoji, normalizeEmoji } from './emoji.js';

export const listConversationsQuerySchema = z.object({
  kind: z.enum(['direct', 'group', 'project']).optional(),
});

/**
 * A page of a thread. `cursor` pages OLDER (the default, scrolling up),
 * `after` pages NEWER (after jumping back in history), `around` opens a
 * window centred on one message (a search result, a pin, a saved message).
 */
export const listMessagesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  cursor: z.string().max(200).optional(),
  after: z.string().max(200).optional(),
  around: z.string().uuid().optional(),
});

export const startDirectConversationSchema = z.object({
  userId: z.string().uuid(),
});

export const createGroupConversationSchema = z.object({
  name: z.string().trim().min(1, 'Group name is required').max(200),
  description: z.string().trim().max(2000).optional().nullable(),
  memberIds: z.array(z.string().uuid()).min(1, 'A group needs at least one member besides you').max(500),
});

export const renameGroupSchema = z.object({
  name: z.string().trim().min(1, 'Group name is required').max(200),
  description: z.string().trim().max(2000).optional().nullable(),
});

export const addGroupMembersSchema = z.object({
  memberIds: z.array(z.string().uuid()).min(1).max(500),
});

const messageBody = z.string().max(10000, 'Messages can be at most 10,000 characters');
const attachmentIds = z.array(z.string().uuid()).max(MAX_ATTACHMENTS_PER_MESSAGE, `A message can carry at most ${MAX_ATTACHMENTS_PER_MESSAGE} files`);

/** Text, files, or both — but never nothing. */
export const sendMessageSchema = z
  .object({
    body: messageBody.default(''),
    replyToMessageId: z.string().uuid().optional().nullable(),
    mentionedUserIds: z.array(z.string().uuid()).max(50).optional(),
    attachmentIds: attachmentIds.optional(),
  })
  .transform((input) => ({ ...input, body: input.body.trim() }))
  .refine((input) => input.body.length > 0 || (input.attachmentIds?.length ?? 0) > 0, {
    message: 'Message cannot be empty',
    path: ['body'],
  });

export const editMessageSchema = z.object({
  body: messageBody.transform((body) => body.trim()),
  mentionedUserIds: z.array(z.string().uuid()).max(50).optional(),
});

export const forwardMessageSchema = z.object({
  conversationId: z.string().uuid(),
});

/** Any single Unicode emoji (RGI), not just the quick-reaction six. */
export const reactionSchema = z.object({
  emoji: z
    .string()
    .min(1)
    .max(32)
    .transform(normalizeEmoji)
    .refine(isSingleEmoji, 'Choose a single emoji'),
});

export const searchQuerySchema = z
  .object({
    q: z.string().trim().max(200).optional(),
    conversationId: z.string().uuid().optional(),
    senderId: z.string().uuid().optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    type: z.enum(['image', 'pdf', 'document', 'spreadsheet', 'presentation', 'file', 'link']).optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
    cursor: z.string().max(200).optional(),
  })
  .refine((input) => (input.q?.length ?? 0) > 0 || input.conversationId || input.senderId || input.from || input.to || input.type, {
    message: 'Type something to search for, or choose a filter',
    path: ['q'],
  });

export const savedQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().max(200).optional(),
});

const sendAt = z.coerce.date();

export const scheduleMessageSchema = z
  .object({
    body: messageBody.default(''),
    replyToMessageId: z.string().uuid().optional().nullable(),
    mentionedUserIds: z.array(z.string().uuid()).max(50).optional(),
    attachmentIds: attachmentIds.optional(),
    sendAt,
  })
  .transform((input) => ({ ...input, body: input.body.trim() }))
  .refine((input) => input.body.length > 0 || (input.attachmentIds?.length ?? 0) > 0, {
    message: 'Message cannot be empty',
    path: ['body'],
  });

export const updateScheduledSchema = z
  .object({
    body: messageBody.transform((body) => body.trim()).optional(),
    mentionedUserIds: z.array(z.string().uuid()).max(50).optional(),
    sendAt: sendAt.optional(),
  })
  .refine((input) => input.body !== undefined || input.sendAt !== undefined, { message: 'Nothing to change' });

export const listScheduledQuerySchema = z.object({
  conversationId: z.string().uuid().optional(),
});

export type ListConversationsQuery = z.infer<typeof listConversationsQuerySchema>;
export type ListMessagesQuery = z.infer<typeof listMessagesQuerySchema>;
export type StartDirectConversationInput = z.infer<typeof startDirectConversationSchema>;
export type CreateGroupConversationInput = z.infer<typeof createGroupConversationSchema>;
export type SendMessageInput = z.infer<typeof sendMessageSchema>;
export type EditMessageInput = z.infer<typeof editMessageSchema>;
export type ForwardMessageInput = z.infer<typeof forwardMessageSchema>;
export type ReactionInput = z.infer<typeof reactionSchema>;
export type SearchQuery = z.infer<typeof searchQuerySchema>;
export type ScheduleMessageInput = z.infer<typeof scheduleMessageSchema>;
export type UpdateScheduledInput = z.infer<typeof updateScheduledSchema>;
