import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as Facade from '../notifications/facade.js';

vi.mock('../notifications/facade.js', async (importOriginal) => ({
  ...(await importOriginal<typeof Facade>()),
  notify: vi.fn().mockResolvedValue(undefined),
  fullNames: vi.fn().mockResolvedValue(new Map([['22222222-2222-4222-8222-222222222222', 'Ravi Kumar']])),
}));

import { notify } from '../notifications/facade.js';
import { notifyLeaveDecided, notifyLeaveRequested } from './notifications.js';

const HR = '11111111-1111-4111-8111-111111111111';
const RAVI = '22222222-2222-4222-8222-222222222222';
const tx = {} as never;
const asRavi = { organizationId: 'org', principal: { id: RAVI } } as never;
const asHr = { organizationId: 'org', principal: { id: HR } } as never;
const call = (n = 0): Record<string, unknown> => vi.mocked(notify).mock.calls[n]![2] as never;

const request = {
  id: 'leave-1',
  userId: RAVI,
  kind: 'absence' as const,
  fromDate: '2026-11-10' as never,
  toDate: '2026-11-12' as never,
  daysConsumed: 3,
  recurrenceType: null,
  recurrenceEnd: null,
};

beforeEach(() => vi.mocked(notify).mockClear());

describe('leave notifications', () => {
  it('asks everyone who can decide, operationally, and points at the queue', async () => {
    await notifyLeaveRequested(tx, asRavi, request, 'Casual Leave');
    expect(call()).toMatchObject({
      type: 'leave.requested',
      priority: 'operational',
      audience: { holders: { action: 'leave:decide' }, excludeUserIds: [RAVI] },
      title: 'Ravi Kumar requested Casual Leave',
      body: '10–12 Nov 2026 (3 days)',
      link: '/company/leave/queue',
      metadata: { leaveRequestId: 'leave-1' },
    });
  });

  it('describes work from home and standing requests', async () => {
    await notifyLeaveRequested(tx, asRavi, { ...request, kind: 'attendance-mode', daysConsumed: 0 }, 'WFH');
    expect(call()).toMatchObject({ title: 'Ravi Kumar requested WFH (work from home)', body: '10–12 Nov 2026' });
    await notifyLeaveRequested(
      tx,
      asRavi,
      { ...request, kind: 'attendance-mode', daysConsumed: 0, recurrenceType: 'daily', recurrenceEnd: '2026-12-31' as never },
      'WFH',
    );
    expect(call(1)['body']).toBe('every working day, 10 Nov 2026 to 31 Dec 2026');
  });

  it('tells the employee the outcome; a decline or revocation is operational', async () => {
    await notifyLeaveDecided(tx, asHr, request, 'approved', 'Casual Leave', null);
    expect(call()).toMatchObject({
      type: 'leave.decided',
      priority: 'informational',
      audience: { users: [RAVI] },
      title: 'Your Casual Leave was approved',
      link: '/company/leave/my',
    });
    await notifyLeaveDecided(tx, asHr, request, 'rejected', 'Casual Leave', 'Team is short that week');
    expect(call(1)).toMatchObject({
      priority: 'operational',
      title: 'Your Casual Leave request was declined',
      body: '10–12 Nov 2026 (3 days) — "Team is short that week"',
    });
    await notifyLeaveDecided(tx, asHr, request, 'revoked', 'Casual Leave', undefined);
    expect(call(2)).toMatchObject({ priority: 'operational', title: 'Your approved Casual Leave was revoked' });
  });

  it('never tells someone about their own decision', async () => {
    await notifyLeaveDecided(tx, asRavi, request, 'approved', 'Casual Leave', null);
    expect(notify).not.toHaveBeenCalled();
  });
});
