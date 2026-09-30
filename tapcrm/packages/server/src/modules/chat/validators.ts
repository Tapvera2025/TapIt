import { z } from 'zod';
import { REACTION_EMOJI } from './types.js';

export const listConversationsQuerySchema = z.object({
  kind: z.enum(['direct', 'group', 'project']).optional(),
});

export const listMessagesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  cursor: z.string().max(200).optional(),
});

export const startDirectConversationSchema = z.object({
  userId: z.string().uuid(),
});

export const createGroupConversationSchema = z.object({
  name: z.string().trim().min(1, 'Group name is required').max(200),
  memberIds: z.array(z.string().uuid()).min(1, 'A group needs at least one member besides you').max(500),
});

export const sendMessageSchema = z.object({
  body: z.string().trim().min(1, 'Message cannot be empty').max(10000),
  replyToMessageId: z.string().uuid().optional().nullable(),
});

export const forwardMessageSchema = z.object({
  conversationId: z.string().uuid(),
});

export const reactionSchema = z.object({
  emoji: z.enum(REACTION_EMOJI),
});

export type ListConversationsQuery = z.infer<typeof listConversationsQuerySchema>;
export type ListMessagesQuery = z.infer<typeof listMessagesQuerySchema>;
export type StartDirectConversationInput = z.infer<typeof startDirectConversationSchema>;
export type CreateGroupConversationInput = z.infer<typeof createGroupConversationSchema>;
export type SendMessageInput = z.infer<typeof sendMessageSchema>;
export type ForwardMessageInput = z.infer<typeof forwardMessageSchema>;
export type ReactionInput = z.infer<typeof reactionSchema>;
