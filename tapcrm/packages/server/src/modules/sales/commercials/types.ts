/**
 * Sales v1.1 R2 — Commercials types (R2 plan step 2.8).
 *
 * All amounts are integer minor units (paise) as `bigint`. Quantities are
 * stored as bigint "micros" (fixed-point ×10⁴) to match the DB precision
 * `numeric(14,4)` without ever touching JS `number`.
 */

export const COMMERCIALS_STATES = [
  'draft',
  'published',
  'superseded',
  'expired',
  'accepted',
  'rejected',
] as const;
export type CommercialsState = (typeof COMMERCIALS_STATES)[number];

/** Scale factor between quantity's human form and its bigint-micros form. */
export const QUANTITY_SCALE = 10_000n;

/** Basis-point denominator — 10000 bps = 100%. */
export const BPS_DENOMINATOR = 10_000n;

/** Shape consumed by the math layer. All numeric fields are bigint. */
export interface CommercialsItemMath {
  readonly quantityMicros: bigint;        // quantity × 10⁴
  readonly unitPriceMinor: bigint;        // paise
  readonly itemDiscountMinor: bigint;     // paise, non-negative, pre-tax
  readonly taxCategory: string;
  readonly taxRateBps: number;            // 0..10000 inclusive
}

/** Document-level discount — resolved by the math layer to an absolute paise amount. */
export type DocumentDiscount =
  | { readonly kind: 'none' }
  | { readonly kind: 'absolute'; readonly amountMinor: bigint }
  | { readonly kind: 'percent'; readonly bps: number };

export interface CommercialsMathInput {
  readonly items: readonly CommercialsItemMath[];
  readonly documentDiscount: DocumentDiscount;
}

export interface CommercialsMathResult {
  readonly subtotalMinor: bigint;           // Σ lineTotal, before document discount, before tax
  readonly discountMinor: bigint;           // document discount resolved to paise, clamped to [0, subtotal]
  readonly taxMinor: bigint;                // Σ tax per rate group, from discounted bases
  readonly totalMinor: bigint;              // subtotal − discount + tax
  readonly lineTotals: readonly bigint[];   // one per input item, same order
}
