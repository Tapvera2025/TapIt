/**
 * Chat module domain and API types.
 *
 * Phase 2 of the messaging build (team-docs has the full plan): Direct
 * Messages. `ConversationKind` already includes 'group' and 'project' so
 * Phase 3 (Internal Groups) and Phase 4 (Project Groups) need no further
 * migration, only new routes and callers of the same service functions.
 */

export type ConversationKind = 'direct' | 'group' | 'project';

export const REACTION_EMOJI = ['👍', '❤️', '😂', '😮', '😢', '🙏'] as const;
export type ReactionEmoji = (typeof REACTION_EMOJI)[number];

export interface ConversationMember {
  readonly userId: string;
  readonly fullName: string;
  readonly lastReadAt: Date | null;
}

export interface Conversation {
  readonly id: string;
  readonly organizationId: string;
  readonly kind: ConversationKind;
  /** Display name for group/project; null for direct (client renders the other member). */
  readonly name: string | null;
  /** Group/project only; null for direct. */
  readonly description: string | null;
  readonly projectId: string | null;
  readonly createdBy: string;
  readonly createdAt: Date;
  readonly members: readonly ConversationMember[];
  readonly lastMessage: MessagePreview | null;
  readonly unreadCount: number;
}

export interface MessagePreview {
  readonly id: string;
  readonly senderId: string;
  readonly body: string | null;
  readonly deletedAt: Date | null;
  readonly createdAt: Date;
}

export interface MessageReaction {
  readonly userId: string;
  readonly emoji: ReactionEmoji;
}

export interface MessageMention {
  readonly userId: string;
  readonly fullName: string;
}

export interface Message {
  readonly id: string;
  readonly organizationId: string;
  readonly conversationId: string;
  readonly senderId: string;
  readonly body: string | null;
  readonly replyToMessageId: string | null;
  readonly replyPreview: MessagePreview | null;
  readonly forwarded: boolean;
  readonly forwardedFromSenderId: string | null;
  readonly deletedAt: Date | null;
  readonly createdAt: Date;
  readonly reactions: readonly MessageReaction[];
  /** Other members whose read cursor has reached this message (CH-derived "seen by"). */
  readonly seenBy: readonly string[];
  /** Who this message @mentioned, resolved to their current name (not re-derived from the body text). */
  readonly mentions: readonly MessageMention[];
}

export interface ConversationResource {
  readonly type: 'chatConversation';
  readonly id: string;
  readonly organizationId: string;
  readonly memberIds: readonly string[];
  readonly [field: string]: unknown;
}
