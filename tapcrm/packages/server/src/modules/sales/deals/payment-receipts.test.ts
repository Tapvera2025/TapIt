import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RequestContext } from '../../../platform/dal/context.js';

/**
 * Confirming a deal's advance writes a receipt, refuses a bank reference that
 * already backs a live receipt, needs a published proposal to check the amount
 * against, and posts Bank Dr / Advances from Customers Cr only when the ledger
 * can take it. Database calls are stubbed by SQL text.
 */

interface State {
  commercials: { advanceMinor: string; state: string } | null;
  reused: { id: string; dealId: string } | null;
  periodOpen: boolean;
  currency: string;
  receipts: Record<string, unknown>[];
  postings: Record<string, unknown>[];
  receiptPosting: Record<string, unknown> | null;
}
const state = vi.hoisted((): State => ({
  commercials: { advanceMinor: '5000000', state: 'published' },
  reused: null,
  periodOpen: true,
  currency: 'INR',
  receipts: [],
  postings: [],
  receiptPosting: null,
}));

const tx = {
  maybeOne: vi.fn(async (query: { sql: string }) => (query.sql.includes('FROM commercials') ? state.commercials : null)),
  query: vi.fn(async () => []),
  one: vi.fn(),
};

vi.mock('../../../platform/dal/db.js', () => ({
  db: { transaction: vi.fn(async (_ctx: unknown, work: (t: unknown) => Promise<unknown>) => work(tx)) },
}));
vi.mock('../../organization/facade.js', () => ({
  getCurrencySettings: vi.fn(async () => ({ defaultCurrency: 'INR', supportedCurrencies: ['INR', 'USD'] })),
}));
vi.mock('../../../platform/organization-time.js', () => ({ organizationToday: vi.fn(async () => '2026-11-16') }));
vi.mock('../../finance/facade.js', () => ({
  openPostingPeriodCoversTx: vi.fn(async () => state.periodOpen),
  postSourceJournalTx: vi.fn(async (_tx: unknown, input: Record<string, unknown>) => {
    state.postings.push(input);
    return { journalId: 'journal-1', duplicate: false };
  }),
}));
vi.mock('./repository.js', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  lockDeal: vi.fn(async () => ({
    id: 'deal-1', dealStage: 'negotiation', lifecycleStatus: 'open',
    responsibleCloserId: 'closer', originatingAgentId: 'sourcer', paymentInitiatedBy: null,
  })),
  findDealTx: vi.fn(async () => ({
    id: 'deal-1', dealNumber: '345', lifecycleStatus: 'open', paymentStatus: 'unpaid',
    commercialsId: state.commercials ? 'com-1' : null, currency: state.currency,
  })),
  findDeal: vi.fn(async () => ({ id: 'deal-1' })),
  findLiveReceiptByReference: vi.fn(async () => state.reused),
  insertPaymentReceipt: vi.fn(async (_tx: unknown, input: Record<string, unknown>) => {
    state.receipts.push(input);
    return 'receipt-1';
  }),
  setReceiptPosting: vi.fn(async (_tx: unknown, _org: string, _id: string, posting: Record<string, unknown>) => {
    state.receiptPosting = posting;
  }),
  updatePaymentStatusRow: vi.fn(async () => undefined),
  insertDealAudit: vi.fn(async () => undefined),
}));

const { confirmPayment } = await import('./service.js');
const finance = { organizationId: 'org-1', requestId: 'r', principal: { id: 'finance', accountType: 'employee' } } as unknown as RequestContext;
const pay = (amountMinor: string, reference = 'UTR-889') => ({ amountMinor, reference, note: null }) as never;

describe('confirming an advance', () => {
  beforeEach(() => {
    state.commercials = { advanceMinor: '5000000', state: 'published' };
    state.reused = null;
    state.periodOpen = true;
    state.currency = 'INR';
    state.receipts = [];
    state.postings = [];
    state.receiptPosting = null;
  });

  it('records a receipt and posts Bank Dr / Advances from Customers Cr', async () => {
    await confirmPayment(finance, 'deal-1', pay('5000000'));
    expect(state.receipts).toEqual([
      expect.objectContaining({ dealId: 'deal-1', amountMinor: 5000000n, currency: 'INR', reference: 'UTR-889', confirmedBy: 'finance' }),
    ]);
    expect(state.postings).toEqual([
      expect.objectContaining({
        sourceType: 'sales.deal.advance',
        sourceId: 'receipt-1',
        entryDate: '2026-11-16',
        lines: [
          { accountKey: 'bank', amountPaise: 5000000n, side: 'debit' },
          { accountKey: 'advances-from-customers', amountPaise: 5000000n, side: 'credit' },
        ],
      }),
    ]);
    expect(state.receiptPosting).toEqual({ journalId: 'journal-1', note: null });
  });

  it('refuses a bank reference already backing a live receipt on another deal', async () => {
    state.reused = { id: 'receipt-0', dealId: 'deal-9' };
    await expect(confirmPayment(finance, 'deal-1', pay('5000000'))).rejects.toMatchObject({
      status: 409, code: 'DEAL_PAYMENT_REFERENCE_USED',
    });
    expect(state.receipts).toEqual([]);
  });

  it('needs a published proposal to check the amount against', async () => {
    state.commercials = null;
    await expect(confirmPayment(finance, 'deal-1', pay('100'))).rejects.toMatchObject({ code: 'DEAL_PAYMENT_NEEDS_COMMERCIALS' });
    state.commercials = { advanceMinor: '5000000', state: 'draft' };
    await expect(confirmPayment(finance, 'deal-1', pay('5000000'))).rejects.toMatchObject({ code: 'DEAL_PAYMENT_NEEDS_COMMERCIALS' });
  });

  it('still refuses less than the agreed advance', async () => {
    await expect(confirmPayment(finance, 'deal-1', pay('4999999'))).rejects.toMatchObject({ code: 'DEAL_PAYMENT_AMOUNT_INSUFFICIENT' });
  });

  it('records but does not post when no accounting period is open, and says why', async () => {
    state.periodOpen = false;
    await confirmPayment(finance, 'deal-1', pay('5000000'));
    expect(state.postings).toEqual([]);
    expect(state.receiptPosting).toEqual({ journalId: null, note: 'Not posted: no open accounting period covers 2026-11-16.' });
  });

  it('records but does not post a deal in another currency', async () => {
    state.currency = 'USD';
    await confirmPayment(finance, 'deal-1', pay('5000000'));
    expect(state.postings).toEqual([]);
    expect(state.receiptPosting?.['note']).toMatch(/in USD, the books in INR/);
  });
});
