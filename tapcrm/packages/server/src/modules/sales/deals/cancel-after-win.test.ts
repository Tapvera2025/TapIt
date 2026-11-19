import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Authz from '@tapcrm/authz';
import type { RequestContext } from '../../../platform/dal/context.js';

/** What cancelling a won deal leaves behind: brief, project, money. */

interface State {
  brief: { id: string; state: string; projectId: string | null } | null;
  receipt: { id: string; amountMinor: string; currency: string; reference: string } | null;
  project: { name: string; userIds: string[] } | null;
  cancelledBriefs: string[];
  notices: Array<{ title: string; audience: Record<string, unknown>; body: string }>;
}
const state = vi.hoisted((): State => ({ brief: null, receipt: null, project: null, cancelledBriefs: [], notices: [] }));

vi.mock('../../../platform/dal/db.js', () => ({
  db: { transaction: vi.fn(async (_ctx: unknown, work: (t: unknown) => Promise<unknown>) => work({})) },
}));
vi.mock('@tapcrm/authz', async (original) => ({
  ...(await original<typeof Authz>()),
  effectivePolicy: vi.fn(async () => ({ allowed: true, scope: 'department' })),
}));
vi.mock('../../notifications/facade.js', () => ({
  NOTIFICATION_TYPES: { DEAL_CANCELLED_AFTER_WIN: 'deal.cancelled_after_win' },
  notify: vi.fn(async (_tx: unknown, _ctx: unknown, input: { title: string; audience: Record<string, unknown>; body: string }) => {
    state.notices.push(input);
  }),
}));
vi.mock('../delivery/repository.js', () => ({
  findBriefForDealTx: vi.fn(async () => state.brief),
  findProjectPeopleTx: vi.fn(async () => state.project),
  insertBriefAudit: vi.fn(async () => undefined),
  markCancelled: vi.fn(async (_tx: unknown, _org: string, briefId: string) => { state.cancelledBriefs.push(briefId); }),
}));
vi.mock('./repository.js', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  lockDeal: vi.fn(async () => ({ id: 'deal-1', lifecycleStatus: 'won', responsibleCloserId: 'closer', originatingAgentId: 'closer', paymentInitiatedBy: 'finance' })),
  findDealTx: vi.fn(async () => ({ id: 'deal-1', dealNumber: '345' })),
  findDeal: vi.fn(async () => ({ id: 'deal-1', lifecycleStatus: 'cancelled' })),
  findLiveReceiptForDealTx: vi.fn(async () => state.receipt),
  markCancelledRow: vi.fn(async () => undefined),
  insertDealAudit: vi.fn(async () => undefined),
}));

const { cancelAfterWin } = await import('./service.js');
const head = { organizationId: 'org-1', requestId: 'r', principal: { id: 'sales-head', accountType: 'employee' } } as unknown as RequestContext;

describe('cancelling a won deal', () => {
  beforeEach(() => {
    state.brief = null;
    state.receipt = null;
    state.project = null;
    state.cancelledBriefs = [];
    state.notices = [];
  });

  it('cancels a delivery brief that was not yet accepted', async () => {
    state.brief = { id: 'brief-1', state: 'submitted', projectId: null };
    await cancelAfterWin(head, 'deal-1', { reason: 'Client withdrew' });
    expect(state.cancelledBriefs).toEqual(['brief-1']);
    expect(state.notices).toEqual([]);
  });

  it('leaves an accepted brief and its project running, and asks the project\'s people to decide', async () => {
    state.brief = { id: 'brief-2', state: 'accepted', projectId: 'project-7' };
    state.project = { name: 'Clinic website', userIds: ['pm', 'designer', 'sales-head'] };
    await cancelAfterWin(head, 'deal-1', { reason: 'Client withdrew' });
    expect(state.cancelledBriefs).toEqual([]);
    expect(state.notices).toEqual([
      expect.objectContaining({
        title: 'Deal cancelled: decide what happens to the project',
        audience: { users: ['pm', 'designer'] },
        body: expect.stringContaining('"Clinic website"'),
      }),
    ]);
  });

  it('asks the people who confirm payments for a refund decision when an advance was received', async () => {
    state.receipt = { id: 'receipt-1', amountMinor: '5000000', currency: 'INR', reference: 'UTR-889' };
    await cancelAfterWin(head, 'deal-1', { reason: 'Client withdrew' });
    expect(state.notices).toEqual([
      expect.objectContaining({
        title: 'Refund decision needed',
        audience: { holders: { action: 'deals:confirm-payment' }, excludeUserIds: ['sales-head'] },
        body: expect.stringContaining('INR 50,000.00 (ref UTR-889)'),
      }),
    ]);
  });
});
