/**
 * Sales v1.1 — Manual payment readiness port.
 *
 * Pilot-grade implementation of PaymentReadinessPort. The port reads the
 * deal's own `payment_status` column, which Finance (or Sales HOD acting
 * as Finance for pilot tenants) flips via POST /api/deals/:id/confirm-payment.
 *
 * Readiness semantics:
 *   advance_confirmed | paid  → satisfied
 *   partial                   → not satisfied, "advance not fully confirmed"
 *   unpaid                    → not satisfied, "advance not confirmed"
 *   partially_refunded|refunded → not satisfied, "refund outstanding"
 *
 * This port is deliberately simple: no advance-amount math, no allocation
 * sum against receipts. Those are the gateway integration's job. The
 * manual port only enforces "someone with authority has signed off."
 */

import { sql } from '../../../platform/dal/sql.js';
import type {
  PaymentReadinessPort,
  PaymentReadinessResult,
} from './payments-port.js';
import type { DealPaymentStatus } from './types.js';

const SATISFIED_STATUSES: ReadonlySet<DealPaymentStatus> = new Set([
  'advance_confirmed',
  'paid',
]);

export const manualPaymentReadinessPort: PaymentReadinessPort = {
  async evaluate(tx, organizationId, dealId) {
    const row = await tx.maybeOne<{ paymentStatus: DealPaymentStatus }>(sql`
      SELECT payment_status AS "paymentStatus"
        FROM deal
       WHERE organization_id = ${organizationId}
         AND id              = ${dealId}
    `);
    if (!row) {
      // The caller (readiness evaluator) has already validated the deal
      // exists; if it's gone between loads, treat the gate as closed.
      return result(false, 'Deal not found during payment readiness check.');
    }
    const status = row.paymentStatus;
    if (SATISFIED_STATUSES.has(status)) {
      return result(true, 'Advance confirmed by Finance.');
    }
    // After the SATISFIED_STATUSES guard, only the unsatisfied statuses remain.
    const remaining = status as Exclude<DealPaymentStatus, 'advance_confirmed' | 'paid'>;
    switch (remaining) {
      case 'unpaid':
        return result(false, 'Advance not yet confirmed by Finance.');
      case 'partial':
        return result(false, 'Advance only partially confirmed.');
      case 'partially_refunded':
        return result(false, 'A refund is outstanding on this deal.');
      case 'refunded':
        return result(false, 'This deal has been fully refunded.');
      default: {
        // Exhaustiveness guard — a new state in the enum needs explicit handling.
        const unhandled: never = remaining;
        return result(false, `Unhandled payment status: ${String(unhandled)}`);
      }
    }
  },
};

function result(satisfied: boolean, description: string): PaymentReadinessResult {
  return {
    satisfied,
    description,
    expectedAdvanceMinor: null,
    netVerifiedMinor: null,
  };
}
