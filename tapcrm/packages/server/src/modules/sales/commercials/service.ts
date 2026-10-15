/**
 * Sales v1.1 R2 — Commercials service (R2 plan step 2.8).
 *
 * The authoritative money layer. Downstream (proposals autosave + publish,
 * approvals dimensions, won-recorder readiness) all go through `recompute()`
 * so that there is exactly one implementation of R-PROP-02 order of
 * operations in the codebase.
 */

import { ApplicationError } from '../../../errors.js';
import { computeCommercials } from './math.js';
import type {
  CommercialsItemMath,
  CommercialsMathResult,
  DocumentDiscount,
} from './types.js';
import type {
  CommercialsBodyInput,
  CommercialsItemInput,
  DocumentDiscountInput,
} from './validators.js';

export class CommercialsTotalMismatchError extends ApplicationError {
  constructor(
    expected: Pick<CommercialsMathResult, 'subtotalMinor' | 'discountMinor' | 'taxMinor' | 'totalMinor'>,
    received: Pick<CommercialsMathResult, 'subtotalMinor' | 'discountMinor' | 'taxMinor' | 'totalMinor'>,
  ) {
    super(
      'Commercials totals do not match server-side math',
      422,
      'COMMERCIALS_TOTAL_MISMATCH',
      {
        expected: toJsonTotals(expected),
        received: toJsonTotals(received),
      },
    );
    this.name = 'CommercialsTotalMismatchError';
  }
}

export class CommercialsAdvanceTooLargeError extends ApplicationError {
  constructor(advanceMinor: bigint, totalMinor: bigint) {
    super(
      'advanceMinor cannot exceed the computed total',
      422,
      'COMMERCIALS_ADVANCE_EXCEEDS_TOTAL',
      { advanceMinor: advanceMinor.toString(), totalMinor: totalMinor.toString() },
    );
    this.name = 'CommercialsAdvanceTooLargeError';
  }
}

/** Convert the four bigint totals to strings for JSON transport. */
export function toJsonTotals(result: Pick<CommercialsMathResult, 'subtotalMinor' | 'discountMinor' | 'taxMinor' | 'totalMinor'>): {
  subtotalMinor: string;
  discountMinor: string;
  taxMinor: string;
  totalMinor: string;
} {
  return {
    subtotalMinor: result.subtotalMinor.toString(),
    discountMinor: result.discountMinor.toString(),
    taxMinor: result.taxMinor.toString(),
    totalMinor: result.totalMinor.toString(),
  };
}

/**
 * Parse a schema-validated quantity decimal (e.g. `"2.5"`, `"10"`, `"0.0001"`)
 * into the ×10⁴ bigint micros used by `math.ts`. The validator guarantees
 * at most 4 fractional digits and a non-zero positive value.
 */
export function quantityToMicros(decimal: string): bigint {
  const [integerPart, fractionalPart = ''] = decimal.split('.');
  const padded = (fractionalPart + '0000').slice(0, 4);
  return BigInt((integerPart ?? '0') + padded);
}

export function toMathItem(item: CommercialsItemInput): CommercialsItemMath {
  return {
    quantityMicros: quantityToMicros(item.quantity),
    unitPriceMinor: item.unitPriceMinor,
    itemDiscountMinor: item.itemDiscountMinor,
    taxCategory: item.taxCategory,
    taxRateBps: item.taxRateBps,
  };
}

export function toMathDocumentDiscount(input: DocumentDiscountInput): DocumentDiscount {
  switch (input.kind) {
    case 'none':
      return { kind: 'none' };
    case 'absolute':
      return { kind: 'absolute', amountMinor: input.amountMinor };
    case 'percent':
      return { kind: 'percent', bps: input.bps };
  }
}

/**
 * Server-authoritative recompute. If the client sent `claimedTotals`, drift
 * triggers `COMMERCIALS_TOTAL_MISMATCH`; the server's figures are what land
 * on the row. Enforces the same `advance ≤ total` invariant the DB CHECK does.
 */
export function recompute(input: CommercialsBodyInput): CommercialsMathResult {
  const items = input.items.map(toMathItem);
  const documentDiscount = toMathDocumentDiscount(input.documentDiscount);
  const result = computeCommercials({ items, documentDiscount });

  if (input.advanceMinor > result.totalMinor) {
    throw new CommercialsAdvanceTooLargeError(input.advanceMinor, result.totalMinor);
  }

  if (input.claimedTotals) {
    const claimed = input.claimedTotals;
    const matches =
      claimed.subtotalMinor === result.subtotalMinor &&
      claimed.discountMinor === result.discountMinor &&
      claimed.taxMinor === result.taxMinor &&
      claimed.totalMinor === result.totalMinor;
    if (!matches) {
      throw new CommercialsTotalMismatchError(result, claimed);
    }
  }

  return result;
}
