import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as Facade from '../notifications/facade.js';

const HR = '11111111-1111-4111-8111-111111111111';
const RAVI = '22222222-2222-4222-8222-222222222222';
const TARA = '33333333-3333-4333-8333-333333333333';

vi.mock('../notifications/facade.js', async (importOriginal) => ({
  ...(await importOriginal<typeof Facade>()),
  notify: vi.fn().mockResolvedValue(undefined),
  fullNames: vi.fn().mockResolvedValue(new Map([['22222222-2222-4222-8222-222222222222', 'Ravi Kumar']])),
}));
vi.mock('../organization/facade.js', () => ({
  effectiveManagerId: vi.fn().mockResolvedValue('33333333-3333-4333-8333-333333333333'),
}));

import { notify } from '../notifications/facade.js';
import { effectiveManagerId } from '../organization/facade.js';
import { effectOf, notifyBreachExplained, notifyBreachRecorded, notifyBreachReviewed } from './notifications.js';

const tx = {} as never;
const asHr = { organizationId: 'org', principal: { id: HR } } as never;
const asRavi = { organizationId: 'org', principal: { id: RAVI } } as never;
const call = (n = 0): Record<string, unknown> => vi.mocked(notify).mock.calls[n]![2] as never;
const measure = { totalMinutes: 75, longestMinutes: 40, count: 3 };
const recorded = (consequence: string, status: 'pending' | 'confirmed' = 'pending', previousRuleId: string | null = null) => ({
  organizationId: 'org',
  breachId: 'b1',
  userId: RAVI,
  workDate: '2026-09-12',
  status,
  rule: { ruleId: 'r1', consequence, minutes: 15, amount: '200.00' },
  measure,
  previousRuleId,
});

beforeEach(() => {
  vi.mocked(notify).mockClear();
  vi.mocked(effectiveManagerId).mockClear();
});

describe('break breach notifications', () => {
  it('asks the employee to explain, operationally, pointing at the Today page', async () => {
    await notifyBreachRecorded(tx, recorded('require-explanation'));
    expect(call()).toMatchObject({
      type: 'breaks.explanation_required',
      priority: 'operational',
      audience: { users: [RAVI] },
      title: 'Please explain your break on 12 Sep 2026',
      body: '3 breaks, 75 min in total, longest 40 min. Add a short note on your Today page.',
      link: '/company/attendance/today',
    });
  });

  it('does not repeat itself when a re-evaluation gives the same rule', async () => {
    await notifyBreachRecorded(tx, recorded('require-explanation', 'pending', 'r1'));
    expect(notify).not.toHaveBeenCalled();
  });

  it('tells the manager for a "notify manager" rule', async () => {
    await notifyBreachRecorded(tx, recorded('notify-manager'));
    expect(effectiveManagerId).toHaveBeenCalledWith(tx, 'org', RAVI);
    expect(call()).toMatchObject({
      type: 'breaks.manager_notice',
      audience: { users: [TARA], excludeUserIds: [RAVI] },
      title: 'Ravi Kumar went over the break limit on 12 Sep 2026',
    });
  });

  it('tells the employee what an automatic consequence did, and says nothing while HR reviews', async () => {
    await notifyBreachRecorded(tx, recorded('deduct-amount', 'confirmed'));
    expect(call()).toMatchObject({
      type: 'breaks.breach_applied',
      audience: { users: [RAVI] },
      body: '3 breaks, 75 min in total, longest 40 min. Applied automatically: ₹200 is deducted from pay.',
    });
    vi.mocked(notify).mockClear();
    await notifyBreachRecorded(tx, recorded('mark-late', 'pending'));
    expect(notify).not.toHaveBeenCalled();
  });

  it('describes each consequence', () => {
    expect(effectOf({ consequence: 'deduct-minutes', minutes: 30, amount: null })).toBe('30 minutes are deducted from the day');
    expect(effectOf({ consequence: 'mark-half-day', minutes: null, amount: null })).toBe('the day is marked a half day');
    expect(effectOf({ consequence: 'warn', minutes: null, amount: null })).toBe('this is a warning');
  });

  it('asks the reviewers to read an explanation', async () => {
    await notifyBreachExplained(tx, asRavi, { id: 'b1', userId: RAVI, workDate: '2026-09-12' });
    expect(call()).toMatchObject({
      type: 'breaks.explanation_submitted',
      priority: 'operational',
      audience: { holders: { action: 'breaks:review-breach' }, excludeUserIds: [RAVI] },
      title: 'Ravi Kumar explained a break on 12 Sep 2026',
      link: '/company/breaks/queue',
    });
  });

  it('tells the employee how a review ended', async () => {
    await notifyBreachReviewed(tx, asHr, { id: 'b1', userId: RAVI, workDate: '2026-09-12' }, {
      outcome: 'confirmed',
      rule: { consequence: 'mark-late', minutes: null, amount: null },
    });
    expect(call()).toMatchObject({ title: 'Break breach on 12 Sep 2026 confirmed', body: 'The day is marked late.' });
    await notifyBreachReviewed(tx, asHr, { id: 'b1', userId: RAVI, workDate: '2026-09-12' }, {
      outcome: 'waived',
      reason: 'Client call ran over',
    });
    expect(call(1)).toMatchObject({ title: 'Break breach on 12 Sep 2026 waived', body: 'No penalty applies. Note: "Client call ran over"' });
  });
});
