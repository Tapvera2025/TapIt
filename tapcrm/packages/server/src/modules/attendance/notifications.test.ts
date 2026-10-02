import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as Facade from '../notifications/facade.js';

const HR = '11111111-1111-4111-8111-111111111111';
const RAVI = '22222222-2222-4222-8222-222222222222';
const SA = '33333333-3333-4333-8333-333333333333';

vi.mock('../notifications/facade.js', async (importOriginal) => ({
  ...(await importOriginal<typeof Facade>()),
  notify: vi.fn().mockResolvedValue(undefined),
  fullNames: vi.fn().mockResolvedValue(
    new Map([
      ['11111111-1111-4111-8111-111111111111', 'Hina HR'],
      ['22222222-2222-4222-8222-222222222222', 'Ravi Kumar'],
    ]),
  ),
}));

import { notify } from '../notifications/facade.js';
import { notifyBulkCorrectionRaised, notifyCorrectionDecided, notifyCorrectionRequested } from './notifications.js';

const tx = {} as never;
const as = (id: string) => ({ organizationId: 'org', principal: { id } }) as never;
const call = (n = 0): Record<string, unknown> => vi.mocked(notify).mock.calls[n]![2] as never;

beforeEach(() => vi.mocked(notify).mockClear());

describe('attendance correction notifications', () => {
  it('asks the deciders about a self-request, leaving the employee out', async () => {
    await notifyCorrectionRequested(tx, as(RAVI), {
      id: 'c1', userId: RAVI, workDate: '2026-09-12' as never, kind: 'add-event', requestedBy: RAVI,
    });
    expect(notify).toHaveBeenCalledTimes(1);
    expect(call()).toMatchObject({
      type: 'attendance.correction_requested',
      priority: 'operational',
      audience: { holders: { action: 'attendance:correct' }, excludeUserIds: [RAVI, RAVI] },
      title: 'Ravi Kumar asked to correct 12 Sep 2026',
      body: 'Asks to add a missing punch.',
      link: '/company/attendance/corrections',
    });
  });

  it('also tells the employee when HR raised it for them', async () => {
    await notifyCorrectionRequested(tx, as(HR), {
      id: 'c2', userId: RAVI, workDate: '2026-09-12' as never, kind: 'void-event', requestedBy: HR,
    });
    expect(notify).toHaveBeenCalledTimes(2);
    expect(call()).toMatchObject({ title: 'Correction raised for Ravi Kumar on 12 Sep 2026', body: 'Hina HR asks to remove a punch.' });
    expect(call(1)).toMatchObject({
      audience: { users: [RAVI] },
      title: 'A correction to your attendance on 12 Sep 2026 was raised',
      link: '/company/attendance/my',
    });
  });

  it('sends one message for a batch', async () => {
    await notifyBulkCorrectionRaised(tx, as(HR), { batchId: 'b', workDate: '2026-09-12', userIds: [RAVI, SA] });
    expect(notify).toHaveBeenCalledTimes(1);
    expect(call()['title']).toBe('2 people: attendance corrections for 12 Sep 2026');
  });

  it('tells the employee and the HR requester the outcome', async () => {
    await notifyCorrectionDecided(tx, as(SA), {
      id: 'c2', userId: RAVI, workDate: '2026-09-12' as never, requestedBy: HR, status: 'rejected', decisionNote: 'Gate log shows no entry',
    });
    expect(notify).toHaveBeenCalledTimes(2);
    expect(call()).toMatchObject({
      type: 'attendance.correction_decided',
      priority: 'operational',
      audience: { users: [RAVI] },
      title: 'Your attendance correction for 12 Sep 2026 was declined',
      body: 'The day stays as it was. Note: "Gate log shows no entry"',
    });
    expect(call(1)).toMatchObject({ audience: { users: [HR] }, title: 'Correction for Ravi Kumar on 12 Sep 2026 was declined' });
  });

  it('does not tell the decider about their own decision', async () => {
    await notifyCorrectionDecided(tx, as(HR), {
      id: 'c1', userId: RAVI, workDate: '2026-09-12' as never, requestedBy: RAVI, status: 'approved', decisionNote: null,
    });
    expect(notify).toHaveBeenCalledTimes(1);
    expect(call()).toMatchObject({ priority: 'informational', audience: { users: [RAVI] }, body: 'The day has been recalculated.' });
  });
});
