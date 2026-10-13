/**
 * Sales v1.1 R2 — Commercials math (R2 plan step 2.8, R-PROP-02).
 *
 * Pure, side-effect-free. Every value is a bigint in integer minor units
 * (paise). We never use `number` arithmetic for money — JS `number` loses
 * precision beyond 2⁵³ and `0.1 + 0.2 ≠ 0.3`, which the finance CHECK
 * `total_minor = subtotal − discount + tax` would surface as drift.
 *
 * Order of operations (preserved exactly):
 *   1. itemLine = round((quantity × unitPrice) − itemDiscount)              [per item]
 *   2. subtotal = Σ itemLine
 *   3. discount = resolveDocDiscount(subtotal, docDiscount)                  [absolute paise]
 *   4. for each tax-rate group:                                             [grouping key is taxRateBps]
 *        groupSubtotal   = Σ itemLine within group
 *        groupDiscount   = round(groupSubtotal × discount / subtotal)       [proportional share]
 *        groupBase       = groupSubtotal − groupDiscount
 *        groupTax        = round(groupBase × rateBps / 10000)
 *   5. tax = Σ groupTax
 *   6. total = subtotal − discount + tax
 *
 * All rounding is half-even (banker's rounding) on non-negative inputs.
 */

import type {
  CommercialsItemMath,
  CommercialsMathInput,
  CommercialsMathResult,
  DocumentDiscount,
} from './types.js';
import { BPS_DENOMINATOR, QUANTITY_SCALE } from './types.js';

/**
 * Integer division with half-even (banker's) rounding.
 *
 * Preconditions: `num >= 0n`, `den > 0n`. Money math never has negatives,
 * so the caller is responsible for keeping inputs in range.
 */
export function divRoundHalfEven(num: bigint, den: bigint): bigint {
  if (den <= 0n) throw new RangeError('divRoundHalfEven: divisor must be positive');
  if (num < 0n) throw new RangeError('divRoundHalfEven: dividend must be non-negative');
  const q = num / den;
  const r = num % den;
  const twoR = r * 2n;
  if (twoR < den) return q;
  if (twoR > den) return q + 1n;
  // tie — round to even
  return q % 2n === 0n ? q : q + 1n;
}

/** Per-item line total: round(quantity × unitPrice) − itemDiscount, floored at 0. */
export function lineTotalMinor(item: CommercialsItemMath): bigint {
  const gross = divRoundHalfEven(item.quantityMicros * item.unitPriceMinor, QUANTITY_SCALE);
  const net = gross - item.itemDiscountMinor;
  return net < 0n ? 0n : net;
}

/** Sum of per-item line totals (pre document discount, pre tax). */
export function sumSubtotalMinor(items: readonly CommercialsItemMath[]): bigint {
  let total = 0n;
  for (const item of items) total += lineTotalMinor(item);
  return total;
}

/**
 * Resolve a document-level discount to an absolute paise amount, clamped
 * to the available subtotal. Negative discounts are rejected by the schema;
 * clamping here protects against callers that bypass validation.
 */
export function applyDocumentDiscount(subtotal: bigint, discount: DocumentDiscount): bigint {
  if (subtotal <= 0n) return 0n;
  switch (discount.kind) {
    case 'none':
      return 0n;
    case 'absolute': {
      if (discount.amountMinor <= 0n) return 0n;
      return discount.amountMinor > subtotal ? subtotal : discount.amountMinor;
    }
    case 'percent': {
      if (discount.bps <= 0) return 0n;
      const bpsBig = BigInt(discount.bps);
      const raw = divRoundHalfEven(subtotal * bpsBig, BPS_DENOMINATOR);
      return raw > subtotal ? subtotal : raw;
    }
  }
}

/**
 * Compute total tax by grouping lines by `taxRateBps`, applying the
 * document discount proportionally per group, then multiplying by the rate.
 *
 * Rounding happens three times (group discount, group tax, outer sum
 * is exact), matching the finance spec's per-category grouping (R-PROP-02).
 */
export function documentTaxMinor(
  subtotal: bigint,
  items: readonly CommercialsItemMath[],
  documentDiscount: DocumentDiscount,
): bigint {
  if (items.length === 0 || subtotal <= 0n) return 0n;

  const discount = applyDocumentDiscount(subtotal, documentDiscount);

  // Group item line totals by their tax-rate basis points.
  const groups = new Map<number, bigint>();
  for (const item of items) {
    const line = lineTotalMinor(item);
    const prev = groups.get(item.taxRateBps) ?? 0n;
    groups.set(item.taxRateBps, prev + line);
  }

  let tax = 0n;
  for (const [rateBps, groupSubtotal] of groups) {
    if (rateBps === 0 || groupSubtotal === 0n) continue;
    const groupDiscount =
      discount === 0n ? 0n : divRoundHalfEven(groupSubtotal * discount, subtotal);
    const clampedDiscount = groupDiscount > groupSubtotal ? groupSubtotal : groupDiscount;
    const groupBase = groupSubtotal - clampedDiscount;
    if (groupBase <= 0n) continue;
    tax += divRoundHalfEven(groupBase * BigInt(rateBps), BPS_DENOMINATOR);
  }
  return tax;
}

/** Full pipeline — subtotal → discount → tax → total, preserving the DB invariant. */
export function computeCommercials(input: CommercialsMathInput): CommercialsMathResult {
  const lineTotals = input.items.map(lineTotalMinor);
  let subtotalMinor = 0n;
  for (const line of lineTotals) subtotalMinor += line;

  const discountMinor = applyDocumentDiscount(subtotalMinor, input.documentDiscount);
  const taxMinor = documentTaxMinor(subtotalMinor, input.items, input.documentDiscount);
  const totalMinor = subtotalMinor - discountMinor + taxMinor;

  return { subtotalMinor, discountMinor, taxMinor, totalMinor, lineTotals };
}
