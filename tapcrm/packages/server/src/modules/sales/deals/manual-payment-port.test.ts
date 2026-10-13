import { describe, expect, it } from 'vitest';
import { manualPaymentReadinessPort } from './manual-payment-port.js';
import type { DealPaymentStatus } from './types.js';

function makeTx(paymentStatus: DealPaymentStatus | 'missing') {
  // The port only reads payment_status; we hand it a tiny stand-in that
  // mimics the Tx.maybeOne shape for a single SELECT.
  return {
    async maybeOne() {
      if (paymentStatus === 'missing') return null;
      return { paymentStatus };
    },
  } as unknown as Parameters<typeof manualPaymentReadinessPort.evaluate>[0];
}

const org = '00000000-0000-0000-0000-000000000001';
const deal = '00000000-0000-0000-0000-000000000002';

describe('manualPaymentReadinessPort', () => {
  it('is satisfied once Finance has confirmed advance', async () => {
    const result = await manualPaymentReadinessPort.evaluate(makeTx('advance_confirmed'), org, deal, null);
    expect(result.satisfied).toBe(true);
  });

  it('is satisfied for a fully paid deal', async () => {
    const result = await manualPaymentReadinessPort.evaluate(makeTx('paid'), org, deal, null);
    expect(result.satisfied).toBe(true);
  });

  it('is not satisfied when advance has not been confirmed', async () => {
    const result = await manualPaymentReadinessPort.evaluate(makeTx('unpaid'), org, deal, null);
    expect(result.satisfied).toBe(false);
    expect(result.description).toContain('Advance not yet confirmed');
  });

  it('is not satisfied for partial payments', async () => {
    const result = await manualPaymentReadinessPort.evaluate(makeTx('partial'), org, deal, null);
    expect(result.satisfied).toBe(false);
    expect(result.description).toContain('partially');
  });

  it('is not satisfied once a refund is outstanding', async () => {
    const result = await manualPaymentReadinessPort.evaluate(makeTx('partially_refunded'), org, deal, null);
    expect(result.satisfied).toBe(false);
  });

  it('fails closed when the deal cannot be found', async () => {
    const result = await manualPaymentReadinessPort.evaluate(makeTx('missing'), org, deal, null);
    expect(result.satisfied).toBe(false);
  });
});
