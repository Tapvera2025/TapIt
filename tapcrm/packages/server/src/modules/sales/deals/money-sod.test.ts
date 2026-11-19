import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Authz from '@tapcrm/authz';
import type { RequestContext } from '../../../platform/dal/context.js';

/**
 * Separation of duties on a deal's money: the people who gain from a deal may
 * not confirm its payment or record its win, and the payment confirmer may not
 * also record the win. The database is stubbed; reaching the write is a sentinel.
 */

const REACHED = new Error('reached the write');
const state = vi.hoisted(() => ({
  locked: {
    id: 'deal-1', dealStage: 'negotiation', lifecycleStatus: 'open',
    responsibleCloserId: 'closer', originatingAgentId: 'sourcer', paymentInitiatedBy: null as string | null,
  },
}));

vi.mock('../../../platform/dal/db.js', () => ({
  db: { transaction: vi.fn(async (_ctx: unknown, work: (tx: unknown) => Promise<unknown>) => work({})) },
}));
vi.mock('./repository.js', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  lockDeal: vi.fn(async () => state.locked),
  findDealTx: vi.fn(async () => { throw REACHED; }),
  markWonRow: vi.fn(async () => { throw REACHED; }),
}));
vi.mock('../../organization/facade.js', () => ({
  getCurrencySettings: vi.fn(async () => ({ defaultCurrency: 'INR', supportedCurrencies: ['INR'] })),
}));
vi.mock('./won-readiness.js', () => ({
  evaluateReadiness: vi.fn(async () => ({ canClose: true, unmet: [] })),
  readinessForClose: vi.fn(),
}));
vi.mock('@tapcrm/authz', async (original) => ({
  ...(await original<typeof Authz>()),
  effectivePolicy: vi.fn(async () => ({ allowed: true, scope: 'department' })),
}));

const { confirmPayment } = await import('./service.js');
const { recordWin } = await import('./won.js');

const as = (id: string, accountType: 'employee' | 'super-admin' = 'employee') =>
  ({ organizationId: 'org-1', requestId: 'r', principal: { id, accountType } }) as unknown as RequestContext;
const payment = { amountMinor: '5000000', reference: 'UTR123' } as never;

describe('confirming a deal\'s advance', () => {
  beforeEach(() => { state.locked.paymentInitiatedBy = null; });

  it('is refused to the closer and to the agent who sourced the deal', async () => {
    await expect(confirmPayment(as('closer'), 'deal-1', payment)).rejects.toMatchObject({ code: 'DEAL_OWN_MONEY', status: 403 });
    await expect(confirmPayment(as('sourcer'), 'deal-1', payment)).rejects.toMatchObject({ code: 'DEAL_OWN_MONEY' });
  });

  it('is refused to a Super Admin who is closing the deal', async () => {
    await expect(confirmPayment(as('closer', 'super-admin'), 'deal-1', payment)).rejects.toMatchObject({ code: 'DEAL_OWN_MONEY' });
  });

  it('is allowed for someone else (Finance, the Sales Head)', async () => {
    await expect(confirmPayment(as('finance'), 'deal-1', payment)).rejects.toBe(REACHED);
  });
});

describe('recording a win', () => {
  beforeEach(() => { state.locked.paymentInitiatedBy = 'finance'; });

  it('is refused to the closer and the sourcing agent', async () => {
    await expect(recordWin(as('closer'), 'deal-1')).rejects.toMatchObject({ code: 'DEAL_OWN_MONEY' });
    await expect(recordWin(as('sourcer'), 'deal-1')).rejects.toMatchObject({ code: 'DEAL_OWN_MONEY' });
  });

  it('is refused to the person who confirmed the payment', async () => {
    await expect(recordWin(as('finance'), 'deal-1')).rejects.toMatchObject({ code: 'DEAL_WIN_SAME_AS_PAYMENT_CONFIRMER' });
  });

  it('is allowed for a different person', async () => {
    await expect(recordWin(as('sales-head'), 'deal-1')).rejects.toBe(REACHED);
  });
});
