/**
 * Sales v1.1 R2 — Payment-readiness port (R2 plan step 2.14).
 *
 * The Won recorder needs to know whether a deal has met its payment
 * obligations before it can be closed. In R2 the payments module is
 * deferred (planned Stripe integration), so this port lets the readiness
 * check stay honest without hardcoding a payment schema:
 *
 *   - The port is registered at boot by whichever payments
 *     implementation ships (Razorpay was the R2 plan; we're swapping to
 *     Stripe later).
 *   - Until something registers, a `defaultPort` returns "no advance
 *     required" — the readiness check treats payment as implicitly met.
 *     This is deliberate so the pilot can run without blocking on a
 *     payment integration.
 *
 * Replace via `registerPaymentReadinessPort()` when Stripe lands.
 */

import type { Tx } from '../../../platform/dal/db.js';

export interface PaymentReadinessResult {
  readonly satisfied: boolean;
  /** Human-readable reason the readiness is or isn't satisfied. */
  readonly description: string;
  /** Expected / configured advance in minor units (paise). */
  readonly expectedAdvanceMinor: bigint | null;
  /** Net verified allocations on the deal in minor units. */
  readonly netVerifiedMinor: bigint | null;
}

export interface PaymentReadinessPort {
  evaluate(
    tx: Tx,
    organizationId: string,
    dealId: string,
    commercialsId: string | null,
  ): Promise<PaymentReadinessResult>;
}

const defaultPort: PaymentReadinessPort = {
  async evaluate() {
    return {
      satisfied: true,
      description: 'No payment gateway is registered; readiness check skipped (will tighten with Stripe).',
      expectedAdvanceMinor: null,
      netVerifiedMinor: null,
    };
  },
};

let registered: PaymentReadinessPort | null = null;

export function registerPaymentReadinessPort(port: PaymentReadinessPort): void {
  if (registered !== null) {
    throw new Error('A PaymentReadinessPort is already registered');
  }
  registered = port;
}

export function paymentReadinessPort(): PaymentReadinessPort {
  return registered ?? defaultPort;
}

/** Tests only. */
export function __resetPaymentReadinessPort(): void {
  registered = null;
}
