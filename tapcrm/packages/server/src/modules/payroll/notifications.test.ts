import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as Facade from '../notifications/facade.js';

vi.mock('../notifications/facade.js', async (importOriginal) => ({
  ...(await importOriginal<typeof Facade>()),
  notify: vi.fn().mockResolvedValue(undefined),
}));

import { notify } from '../notifications/facade.js';
import { notifyPayslipRevised, notifyPayslipsPublished } from './notifications.js';

const OWNER = '11111111-1111-4111-8111-111111111111';
const RAVI = '22222222-2222-4222-8222-222222222222';
const tx = {} as never;
const ctx = { organizationId: 'org', principal: { id: OWNER } } as never;
const call = (n = 0): Record<string, unknown> => vi.mocked(notify).mock.calls[n]![2] as never;

beforeEach(() => vi.mocked(notify).mockClear());

describe('payroll notifications', () => {
  it('tells every employee in a published run, without amounts, in batches', async () => {
    const ids = Array.from({ length: 1100 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    await notifyPayslipsPublished(tx, ctx, { id: 'run-1', periodStart: '2026-09-01' }, [...ids, OWNER]);
    expect(notify).toHaveBeenCalledTimes(3);
    expect(call()).toMatchObject({
      type: 'payroll.payslip_published',
      title: 'Your payslip for September 2026 is ready',
      link: '/company/payroll/my-payslips',
    });
    const everyone = vi.mocked(notify).mock.calls.flatMap((c) => (c[2].audience.users ?? []) as string[]);
    expect(everyone).toHaveLength(1100);
    expect(everyone).not.toContain(OWNER);
    expect(JSON.stringify(vi.mocked(notify).mock.calls)).not.toMatch(/₹|paise/);
  });

  it('tells the employee about a revision', async () => {
    await notifyPayslipRevised(tx, ctx, { id: 'slip-2', userId: RAVI, periodStart: '2026-09-01', revisionNumber: 1 });
    expect(call()).toMatchObject({
      type: 'payroll.payslip_revised',
      audience: { users: [RAVI] },
      title: 'Your payslip for September 2026 was revised',
    });
  });
});
