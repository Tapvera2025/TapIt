import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as Facade from '../notifications/facade.js';

vi.mock('../notifications/facade.js', async (importOriginal) => ({
  ...(await importOriginal<typeof Facade>()),
  notify: vi.fn().mockResolvedValue(undefined),
  fullNames: vi.fn().mockResolvedValue(
    new Map([
      ['11111111-1111-4111-8111-111111111111', 'Hina HR'],
      ['22222222-2222-4222-8222-222222222222', 'Ravi Kumar'],
    ]),
  ),
  describePlacement: vi.fn().mockResolvedValue('Senior Developer, Development, reporting to Tara Manager'),
}));

import { notify } from '../notifications/facade.js';
import { notifyRoleChangeDecided, notifyRoleChangeRequested } from './notifications.js';

const HR = '11111111-1111-4111-8111-111111111111';
const RAVI = '22222222-2222-4222-8222-222222222222';
const OWNER = '33333333-3333-4333-8333-333333333333';
const tx = {
  query: vi.fn().mockResolvedValue([
    { id: 'p-dev', name: 'Developer' },
    { id: 'p-senior', name: 'Senior Developer' },
  ]),
} as never;
const as = (id: string) => ({ organizationId: 'org', principal: { id } }) as never;
const call = (n = 0): Record<string, unknown> => vi.mocked(notify).mock.calls[n]![2] as never;
const request = { id: 'rc1', subjectUserId: RAVI, fromPositionId: 'p-dev', toPositionId: 'p-senior', requestedBy: HR };

beforeEach(() => vi.mocked(notify).mockClear());

describe('role change notifications', () => {
  it('asks whoever can decide (the Super Admin), linking to the review tab', async () => {
    await notifyRoleChangeRequested(tx, as(HR), request);
    expect(call()).toMatchObject({
      type: 'access.role_change_requested',
      priority: 'operational',
      audience: { holders: { action: 'access:decide-role-change' }, excludeUserIds: [RAVI] },
      title: 'Position change requested for Ravi Kumar',
      body: 'Developer → Senior Developer. Requested by Hina HR.',
      link: '/company/access/role-changes',
    });
  });

  it('tells HR and the employee about an approval', async () => {
    await notifyRoleChangeDecided(tx, as(OWNER), request, true, 'Promotion cycle');
    expect(notify).toHaveBeenCalledTimes(2);
    expect(call()).toMatchObject({
      audience: { users: [HR] },
      title: 'Position change for Ravi Kumar approved',
      body: 'Moved to Senior Developer. Note: "Promotion cycle"',
    });
    expect(call(1)).toMatchObject({
      audience: { users: [RAVI] },
      title: 'Your position is now Senior Developer',
      body: 'Senior Developer, Development, reporting to Tara Manager.',
    });
  });

  it('tells only HR about a decline', async () => {
    await notifyRoleChangeDecided(tx, as(OWNER), request, false, 'Not this quarter');
    expect(notify).toHaveBeenCalledTimes(1);
    expect(call()).toMatchObject({ audience: { users: [HR] }, title: 'Position change for Ravi Kumar declined' });
  });
});
