import { describe, expect, it } from 'vitest';
import type { ConversationMember } from './api/chatApi.js';
import {
  canChangeAdmin,
  canRemoveMember,
  groupAuthorityFor,
  membersByRank,
} from './groupPermissions.js';

const person = (
  userId: string,
  role: ConversationMember['role'] = 'member',
): ConversationMember => ({
  userId,
  fullName: userId,
  lastReadAt: null,
  role,
});
const group = {
  createdBy: 'creator',
  members: [person('creator'), person('Asha', 'admin'), person('Ben'), person('Cara')],
};

describe('Internal Group permissions (client)', () => {
  it('works out who the viewer is in the group', () => {
    expect(groupAuthorityFor(group, 'creator', false)).toBe('owner');
    expect(groupAuthorityFor(group, 'someone-else', true)).toBe('owner');
    expect(groupAuthorityFor(group, 'Asha', false)).toBe('admin');
    expect(groupAuthorityFor(group, 'Ben', false)).toBe('member');
  });

  it('lets the owner remove anyone but the creator, and an admin only ordinary members', () => {
    expect(canRemoveMember('owner', person('Asha', 'admin'), 'creator')).toBe(true);
    expect(canRemoveMember('owner', person('creator'), 'creator')).toBe(false);
    expect(canRemoveMember('admin', person('Ben'), 'creator')).toBe(true);
    expect(canRemoveMember('admin', person('Asha', 'admin'), 'creator')).toBe(false);
    expect(canRemoveMember('member', person('Ben'), 'creator')).toBe(false);
  });

  it('lets only the owner make or remove admins', () => {
    expect(canChangeAdmin('owner', person('Ben'), 'creator')).toBe(true);
    expect(canChangeAdmin('owner', person('creator'), 'creator')).toBe(false);
    expect(canChangeAdmin('admin', person('Ben'), 'creator')).toBe(false);
  });

  it('lists the creator first, then admins, then everyone else by name', () => {
    expect(membersByRank(group.members, 'creator').map((m) => m.userId)).toEqual([
      'creator',
      'Asha',
      'Ben',
      'Cara',
    ]);
  });
});
