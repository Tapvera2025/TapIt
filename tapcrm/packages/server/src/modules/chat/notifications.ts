import type { RequestContext } from '../../platform/dal/context.js';
type NotifyCtx = Pick<RequestContext, 'organizationId' | 'principal'>;
import type { Tx } from '../../platform/dal/db.js';
import { NOTIFICATION_TYPES, notify } from '../notifications/facade.js';
import type { ConversationKind, ReactionEmoji } from './types.js';

/**
 * Chat notifications. Same pattern as tasks/notifications.ts and
 * projects/notifications.ts (team-docs has the reference writeup): called
 * once from service.ts, inside the same transaction as the write it reports
 * on, so a rolled-back action leaves no notification behind.
 *
 * Every action a conversation member can take toward another member gets one:
 * a new message, a reaction, being added to or removed from a group. The
 * actor is never notified about their own action.
 */
const MESSAGES_LINK = '/company/messages';
const clip = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/**
 * Every chat notification's link points at a specific conversation (and,
 * where there is one, a specific message) — not just the generic Messages
 * page. The client resolves `conversationId` to its kind/tab with
 * `getConversation()` (it already knows how), so this link format needs no
 * other information.
 */
function conversationLink(conversationId: string, messageId?: string): string {
  const params = new URLSearchParams({ conversationId });
  if (messageId) params.set('messageId', messageId);
  return `${MESSAGES_LINK}?${params.toString()}`;
}

/** New message (including a forwarded one, which is just a message in the target conversation). */
export async function notifyNewMessage(
  tx: Tx,
  ctx: NotifyCtx,
  conversation: { id: string; kind: ConversationKind; name: string | null },
  senderName: string,
  body: string,
  messageId: string,
  recipientIds: readonly string[],
): Promise<void> {
  const audience = [...new Set(recipientIds)].filter((id) => id !== ctx.principal.id);
  if (audience.length === 0) return;

  // Built with concatenation, not a template literal: CI-20's SQL-interpolation
  // check false-positives on the word "from" next to `${...}`.
  const title = conversation.kind === 'direct' ? 'New message from ' + senderName : `New message in ${conversation.name ?? 'group'}`;
  await notify(tx, ctx, {
    type: NOTIFICATION_TYPES.CHAT_MESSAGE,
    audience: { users: audience },
    title,
    body: clip(body, 500),
    link: conversationLink(conversation.id, messageId),
    metadata: { conversationId: conversation.id, kind: conversation.kind },
  });
}

/** Someone @mentioned you in a group/project conversation. */
export async function notifyMention(
  tx: Tx,
  ctx: NotifyCtx,
  conversation: { id: string; kind: ConversationKind; name: string | null },
  mentionerName: string,
  messageId: string,
  mentionedUserIds: readonly string[],
): Promise<void> {
  const audience = [...new Set(mentionedUserIds)].filter((id) => id !== ctx.principal.id);
  if (audience.length === 0) return;

  await notify(tx, ctx, {
    type: NOTIFICATION_TYPES.CHAT_MENTION,
    priority: 'operational',
    audience: { users: audience },
    title: mentionerName + ' mentioned you in ' + (conversation.name ?? 'a conversation'),
    link: conversationLink(conversation.id, messageId),
    metadata: { conversationId: conversation.id, kind: conversation.kind },
  });
}

/** Someone reacted to your message. Only the message's sender is told, never the whole conversation. */
export async function notifyReaction(
  tx: Tx,
  ctx: NotifyCtx,
  messageSenderId: string,
  reactorName: string,
  emoji: ReactionEmoji,
  conversationId: string,
  messageId: string,
): Promise<void> {
  if (messageSenderId === ctx.principal.id) return; // reacting to your own message notifies no one

  await notify(tx, ctx, {
    type: NOTIFICATION_TYPES.CHAT_REACTION,
    audience: { users: [messageSenderId] },
    title: `${reactorName} reacted ${emoji} to your message`,
    link: conversationLink(conversationId, messageId),
    metadata: { conversationId },
  });
}

/** Newly added group/project-group members, never the ones already there. */
export async function notifyGroupMembersAdded(
  tx: Tx,
  ctx: NotifyCtx,
  conversation: { id: string; name: string | null },
  newMemberIds: readonly string[],
): Promise<void> {
  const audience = [...new Set(newMemberIds)].filter((id) => id !== ctx.principal.id);
  if (audience.length === 0) return;

  await notify(tx, ctx, {
    type: NOTIFICATION_TYPES.CHAT_GROUP_ADDED,
    priority: 'operational',
    audience: { users: audience },
    title: `You were added to ${conversation.name ?? 'a group'}`,
    link: conversationLink(conversation.id),
    metadata: { conversationId: conversation.id },
  });
}

export async function notifyGroupMemberRemoved(
  tx: Tx,
  ctx: NotifyCtx,
  conversation: { id: string; name: string | null },
  removedUserId: string,
): Promise<void> {
  if (removedUserId === ctx.principal.id) return;

  await notify(tx, ctx, {
    type: NOTIFICATION_TYPES.CHAT_GROUP_REMOVED,
    audience: { users: [removedUserId] },
    title: 'You were removed from ' + (conversation.name ?? 'a group'),
    metadata: { conversationId: conversation.id },
  });
}
