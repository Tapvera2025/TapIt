import { describe, expect, it } from 'vitest';
import { groupActionRefusal, groupAuthority, type GroupAction } from './group-roles.js';

const member = { isCreator: false, role: 'member' as const };
const admin = { isCreator: false, role: 'admin' as const };
const creator = { isCreator: true, role: 'member' as const };

function allowed(
  authority: Parameters<typeof groupActionRefusal>[0],
  action: GroupAction,
  archived = false,
) {
  return groupActionRefusal(authority, action, archived) === null;
}

describe('Internal Group roles', () => {
  it('treats the creator and any Super Admin as the owner', () => {
    expect(
      groupAuthority({ isSuperAdmin: false, isCreator: true, memberRole: 'member' }),
    ).toBe('owner');
    expect(
      groupAuthority({ isSuperAdmin: true, isCreator: false, memberRole: null }),
    ).toBe('owner');
    expect(
      groupAuthority({ isSuperAdmin: false, isCreator: false, memberRole: 'admin' }),
    ).toBe('admin');
    expect(
      groupAuthority({ isSuperAdmin: false, isCreator: false, memberRole: 'member' }),
    ).toBe('member');
    expect(
      groupAuthority({ isSuperAdmin: false, isCreator: false, memberRole: null }),
    ).toBe('none');
  });

  it('lets the owner do everything except remove the creator', () => {
    for (const action of [
      { type: 'edit' },
      { type: 'add-members' },
      { type: 'remove-member', target: member },
      { type: 'remove-member', target: admin },
      { type: 'set-role', target: member },
      { type: 'archive' },
      { type: 'delete' },
    ] as GroupAction[]) {
      expect(allowed('owner', action)).toBe(true);
    }
    expect(
      groupActionRefusal('owner', { type: 'remove-member', target: creator }, false),
    ).toEqual({
      message: 'The group creator cannot be removed.',
      forbidden: false,
    });
  });

  it('lets an admin edit, add people and remove ordinary members only', () => {
    expect(allowed('admin', { type: 'edit' })).toBe(true);
    expect(allowed('admin', { type: 'add-members' })).toBe(true);
    expect(allowed('admin', { type: 'remove-member', target: member })).toBe(true);
    expect(
      groupActionRefusal('admin', { type: 'remove-member', target: admin }, false)
        ?.forbidden,
    ).toBe(true);
    expect(allowed('admin', { type: 'remove-member', target: creator })).toBe(false);
    expect(
      groupActionRefusal('admin', { type: 'set-role', target: member }, false)?.forbidden,
    ).toBe(true);
    for (const type of ['archive', 'restore', 'delete'] as const) {
      expect(groupActionRefusal('admin', { type }, true)?.forbidden).toBe(true);
    }
  });

  it('lets an ordinary member change nothing', () => {
    for (const action of [
      { type: 'edit' },
      { type: 'add-members' },
      { type: 'remove-member', target: member },
      { type: 'set-role', target: member },
      { type: 'archive' },
      { type: 'delete' },
    ] as GroupAction[]) {
      expect(groupActionRefusal('member', action, false)?.forbidden).toBe(true);
    }
  });

  it('keeps an archived group read-only until it is restored', () => {
    expect(groupActionRefusal('owner', { type: 'edit' }, true)).toEqual({
      message: 'This group is archived. Restore it before making changes.',
      forbidden: false,
    });
    expect(allowed('owner', { type: 'add-members' }, true)).toBe(false);
    expect(allowed('owner', { type: 'set-role', target: member }, true)).toBe(false);
    expect(allowed('owner', { type: 'restore' }, true)).toBe(true);
    expect(allowed('owner', { type: 'delete' }, true)).toBe(true);
    expect(allowed('owner', { type: 'archive' }, true)).toBe(false);
    expect(allowed('owner', { type: 'restore' }, false)).toBe(false);
  });
});
