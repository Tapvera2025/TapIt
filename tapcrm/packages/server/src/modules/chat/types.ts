/**
 * Chat module domain and API types.
 *
 * Phase 2 of the messaging build (team-docs has the full plan): Direct
 * Messages. `ConversationKind` already includes 'group' and 'project' so
 * Phase 3 (Internal Groups) and Phase 4 (Project Groups) need no further
 * migration, only new routes and callers of the same service functions.
 *
 * Rich messaging (0133–0140): attachments, search, editing, link previews,
 * pins, any-emoji reactions, saved messages and scheduled sending.
 */

import type { AttachmentKind } from './file-types.js';

export type ConversationKind = 'direct' | 'group' | 'project';
export type { AttachmentKind } from './file-types.js';

export interface ChatUnreadSummary {
  readonly total: number;
  readonly direct: number;
  readonly group: number;
  readonly project: number;
}

/** The quick-reaction bar. Any single Unicode emoji is accepted (0138); these are only the shortcuts. */
export const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'] as const;
/** @deprecated kept for older importers; reactions are no longer limited to this set. */
export const REACTION_EMOJI = QUICK_REACTIONS;
/** One RGI emoji (validated by `isSingleEmoji`). */
export type ReactionEmoji = string;

/** Coarse presence derived from live-status attendance: green / orange / grey dot. */
export type ChatPresence = 'active' | 'idle' | 'offline';

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
  /** How many messages are pinned to its header. */
  readonly pinnedCount: number;
}

export interface MessagePreview {
  readonly id: string;
  readonly senderId: string;
  readonly body: string | null;
  readonly deletedAt: Date | null;
  readonly createdAt: Date;
  /** Files on the message, so a list can say "📎 2 files" for an attachment-only message. */
  readonly attachmentCount: number;
  readonly firstAttachment: { readonly kind: AttachmentKind; readonly fileName: string } | null;
}

export interface MessageReaction {
  readonly userId: string;
  readonly emoji: ReactionEmoji;
}

export interface MessageMention {
  readonly userId: string;
  readonly fullName: string;
}

export interface MessageAttachment {
  readonly id: string;
  readonly kind: AttachmentKind;
  readonly fileName: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly width: number | null;
  readonly height: number | null;
  readonly pageCount: number | null;
  /** Signed, same-origin link that opens the file (images and PDFs inline). */
  readonly url: string;
  /** Signed link that always downloads, with the original file name. */
  readonly downloadUrl: string;
  /** Signed link to the WebP thumbnail (images only). */
  readonly thumbnailUrl: string | null;
}

export interface LinkPreview {
  readonly url: string;
  readonly title: string | null;
  readonly description: string | null;
  readonly siteName: string | null;
  /** figma | github | loom | google-docs | google-sheets | google-slides | google-drive | youtube | null */
  readonly provider: string | null;
  /** Signed link to our cached copy of the page's preview image. */
  readonly imageUrl: string | null;
  readonly imageWidth: number | null;
  readonly imageHeight: number | null;
}

export interface Message {
  readonly id: string;
  readonly organizationId: string;
  readonly conversationId: string;
  readonly senderId: string;
  /** Markdown-flavoured text. '' for a files-only message; null once unsent. */
  readonly body: string | null;
  readonly replyToMessageId: string | null;
  readonly replyPreview: MessagePreview | null;
  readonly forwarded: boolean;
  readonly forwardedFromSenderId: string | null;
  readonly deletedAt: Date | null;
  readonly createdAt: Date;
  /** Set when the sender last edited it; the history is at GET /api/chat/messages/:id/edits. */
  readonly editedAt: Date | null;
  readonly reactions: readonly MessageReaction[];
  /** Other members whose read cursor has reached this message (CH-derived "seen by"). */
  readonly seenBy: readonly string[];
  /** Who this message @mentioned, resolved to their current name (not re-derived from the body text). */
  readonly mentions: readonly MessageMention[];
  readonly attachments: readonly MessageAttachment[];
  readonly linkPreviews: readonly LinkPreview[];
  readonly pinnedAt: Date | null;
  readonly pinnedBy: string | null;
  /** In the VIEWER's saved tray (per person, never shared). */
  readonly saved: boolean;
}

export interface MessageEdit {
  readonly id: string;
  readonly previousBody: string;
  readonly editedBy: string;
  readonly editedAt: Date;
}

export interface PinnedMessage {
  readonly message: Message;
  readonly pinnedAt: Date;
  readonly pinnedBy: string;
  readonly pinnedByName: string;
}

export interface SavedMessage {
  readonly savedAt: Date;
  readonly message: Message;
  readonly conversation: {
    readonly id: string;
    readonly kind: ConversationKind;
    readonly name: string | null;
    readonly projectId: string | null;
    /** Group/project name, or for a DM the other member's name. */
    readonly label: string;
  };
  readonly senderName: string;
}

export interface SearchResult {
  readonly messageId: string;
  readonly conversationId: string;
  readonly conversationKind: ConversationKind;
  /** Group/project name, or for a DM the other member's name. */
  readonly conversationLabel: string;
  readonly senderId: string;
  readonly senderName: string;
  readonly createdAt: Date;
  readonly editedAt: Date | null;
  /** Plain text around the match; ⟦ and ⟧ mark the highlighted terms. */
  readonly snippet: string;
  readonly attachments: readonly { readonly id: string; readonly kind: AttachmentKind; readonly fileName: string }[];
  readonly hasLinks: boolean;
}

export type ScheduledStatus = 'pending' | 'sent' | 'cancelled' | 'failed';

export interface ScheduledMessage {
  readonly id: string;
  readonly conversationId: string;
  readonly body: string;
  readonly replyToMessageId: string | null;
  readonly mentionedUserIds: readonly string[];
  readonly sendAt: Date;
  readonly status: ScheduledStatus;
  readonly sentMessageId: string | null;
  readonly failureReason: string | null;
  readonly createdAt: Date;
  readonly attachments: readonly MessageAttachment[];
}

export interface ConversationResource {
  readonly type: 'chatConversation';
  readonly id: string;
  readonly organizationId: string;
  readonly memberIds: readonly string[];
  readonly [field: string]: unknown;
}
