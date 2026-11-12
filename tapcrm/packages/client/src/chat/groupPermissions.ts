import type { Conversation, ConversationMember } from './api/chatApi.js';

/**
 * What the viewer may do in an Internal Group. Mirrors the server's rules
 * (chat/group-roles.ts), which stay the authority; this only decides which
 * buttons to show.
 *
 * - owner: the creator, or any Super Admin — everything.
 * - admin: edit the group, add people, remove ordinary members.
 * - member: read and post.
 */
export type GroupAuthority = 'owner' | 'admin' | 'member';

export function groupAuthorityFor(
  conversation: Pick<Conversation, 'createdBy' | 'members'>,
  currentUserId: string,
  isSuperAdmin: boolean,
): GroupAuthority {
  if (isSuperAdmin || conversation.createdBy === currentUserId) return 'owner';
  const me = conversation.members.find((member) => member.userId === currentUserId);
  return me?.role === 'admin' ? 'admin' : 'member';
}

/** The creator is never removed; an admin may remove only ordinary members. */
export function canRemoveMember(
  authority: GroupAuthority,
  member: Pick<ConversationMember, 'userId' | 'role'>,
  createdBy: string,
): boolean {
  if (member.userId === createdBy) return false;
  if (authority === 'owner') return true;
  return authority === 'admin' && member.role !== 'admin';
}

/** Only the owner makes or removes admins, and the creator needs no admin role. */
export function canChangeAdmin(
  authority: GroupAuthority,
  member: Pick<ConversationMember, 'userId'>,
  createdBy: string,
): boolean {
  return authority === 'owner' && member.userId !== createdBy;
}

/** Creator first, then admins, then everyone else, each by name. */
export function membersByRank(
  members: readonly ConversationMember[],
  createdBy: string,
): ConversationMember[] {
  const rank = (member: ConversationMember): number =>
    member.userId === createdBy ? 0 : member.role === 'admin' ? 1 : 2;
  return [...members].sort(
    (a, b) => rank(a) - rank(b) || a.fullName.localeCompare(b.fullName),
  );
}
