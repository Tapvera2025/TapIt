import type { GroupMemberRole } from './types.js';

/**
 * Who may do what in an Internal Group (0153).
 *
 * - OWNER: the group's creator, or any Super Admin. Does everything: edits the
 *   group, adds people, removes anyone except the creator, makes and removes
 *   admins, archives, restores and deletes the group.
 * - ADMIN: a member the owner promoted. Helps run the group: edits its name
 *   and description, adds people and removes ordinary members. Cannot touch
 *   other admins, make admins, or archive/delete the group.
 * - MEMBER: reads and posts.
 *
 * An archived group is read-only: nothing about it changes until it is
 * restored (or deleted).
 */
export type GroupAuthority = 'owner' | 'admin' | 'member' | 'none';

export function groupAuthority(input: {
  isSuperAdmin: boolean;
  isCreator: boolean;
  /** The caller's current membership role; null when they are not a member. */
  memberRole: GroupMemberRole | null;
}): GroupAuthority {
  if (input.isSuperAdmin || input.isCreator) return 'owner';
  if (input.memberRole === 'admin') return 'admin';
  return input.memberRole === null ? 'none' : 'member';
}

export type GroupAction =
  | { type: 'edit' }
  | { type: 'add-members' }
  | { type: 'remove-member'; target: { isCreator: boolean; role: GroupMemberRole } }
  | { type: 'set-role'; target: { isCreator: boolean } }
  | { type: 'archive' }
  | { type: 'restore' }
  | { type: 'delete' };

/**
 * Why an action is refused. `forbidden` is about WHO is asking (403); the
 * rest are about the group's state or the person targeted (422).
 */
export interface GroupRefusal {
  readonly message: string;
  readonly forbidden: boolean;
}

const forbidden = (message: string): GroupRefusal => ({ message, forbidden: true });
const invalid = (message: string): GroupRefusal => ({ message, forbidden: false });
const RUNS_GROUP = forbidden('Only the group creator or a group admin can do this.');
const CREATOR_ONLY = forbidden('Only the group creator can do this.');

/** Why someone with `authority` may not take `action` on a group; null when they may. */
export function groupActionRefusal(
  authority: GroupAuthority,
  action: GroupAction,
  archived: boolean,
): GroupRefusal | null {
  switch (action.type) {
    case 'archive':
      if (authority !== 'owner') return CREATOR_ONLY;
      return archived ? invalid('This group is already archived.') : null;
    case 'restore':
      if (authority !== 'owner') return CREATOR_ONLY;
      return archived ? null : invalid('This group is not archived.');
    case 'delete':
      return authority === 'owner' ? null : CREATOR_ONLY;
    default:
      break;
  }
  if (archived)
    return invalid('This group is archived. Restore it before making changes.');
  switch (action.type) {
    case 'edit':
    case 'add-members':
      return authority === 'owner' || authority === 'admin' ? null : RUNS_GROUP;
    case 'remove-member':
      if (action.target.isCreator) return invalid('The group creator cannot be removed.');
      if (authority === 'owner') return null;
      if (authority === 'admin')
        return action.target.role === 'admin'
          ? forbidden('Only the group creator can remove an admin.')
          : null;
      return RUNS_GROUP;
    case 'set-role':
      if (authority !== 'owner')
        return forbidden('Only the group creator can make or remove admins.');
      return action.target.isCreator
        ? invalid('The group creator already runs this group.')
        : null;
  }
}
