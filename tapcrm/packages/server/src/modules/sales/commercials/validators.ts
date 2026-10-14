/**
 * Sales v1.1 R2 — Commercials validators (R2 plan step 2.8).
 *
 * Zod schemas for the proposal body + items the client sends. All money
 * is parsed into bigint minor units (paise) by these schemas, never left
 * as `number`. Quantities are kept as the canonical decimal string the
 * client sent (e.g. `"2.5000"`); the service layer converts to the ×10⁴
 * bigint micros used by `math.ts` via `quantityToMicros`.
 */

import { z } from 'zod';

/** 3-letter ISO 4217 currency code, upper-cased. */
export const currencySchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, 'currency must be a 3-letter ISO 4217 code');

/** Decimal quantity with up to 4 fractional digits; the DB column is numeric(14,4). */
const QUANTITY_RE = /^\d+(?:\.\d{1,4})?$/;
export const quantityDecimalSchema = z
  .union([z.string(), z.number()])
  .transform((v) => (typeof v === 'number' ? v.toString() : v.trim()))
  .refine((s) => QUANTITY_RE.test(s), {
    message: 'quantity must be a non-negative decimal with up to 4 fractional digits',
  })
  .refine((s) => Number(s) > 0, { message: 'quantity must be greater than 0' });

/**
 * Non-negative integer minor units. Accepts bigint, integer `number`, or
 * digit-only string (JSON cannot carry bigint, so clients send strings).
 */
export const minorAmountSchema = z
  .union([z.bigint(), z.number(), z.string()])
  .transform((v, ctx) => {
    try {
      if (typeof v === 'bigint') return v;
      if (typeof v === 'number') {
        if (!Number.isInteger(v) || !Number.isSafeInteger(v)) {
          throw new Error('minor amount must be a safe integer');
        }
        return BigInt(v);
      }
      if (!/^\d+$/.test(v)) throw new Error('minor amount must be a non-negative integer');
      return BigInt(v);
    } catch (err) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: err instanceof Error ? err.message : 'invalid minor amount',
      });
      return z.NEVER;
    }
  })
  .refine((v) => v >= 0n, { message: 'minor amount must be non-negative' });

export const taxRateBpsSchema = z
  .number()
  .int()
  .min(0, 'taxRateBps must be ≥ 0')
  .max(10_000, 'taxRateBps must be ≤ 10000 (100%)');

export const commercialsItemInputSchema = z.object({
  serviceName: z.string().trim().min(1).max(200),
  description: z.string().trim().max(1000).optional(),
  quantity: quantityDecimalSchema,
  unitPriceMinor: minorAmountSchema,
  itemDiscountMinor: minorAmountSchema.default(0n),
  taxCategory: z.string().trim().min(1).max(50).default('standard'),
  taxRateBps: taxRateBpsSchema.default(0),
  milestone: z.string().trim().max(100).optional(),
  sortOrder: z.number().int().min(0).default(0),
});
export type CommercialsItemInput = z.infer<typeof commercialsItemInputSchema>;

/** Document-level discount — resolved by the math layer to an absolute paise amount. */
export const documentDiscountSchema = z
  .discriminatedUnion('kind', [
    z.object({ kind: z.literal('none') }),
    z.object({ kind: z.literal('absolute'), amountMinor: minorAmountSchema }),
    z.object({ kind: z.literal('percent'), bps: z.number().int().min(0).max(10_000) }),
  ])
  .default({ kind: 'none' });
export type DocumentDiscountInput = z.infer<typeof documentDiscountSchema>;

/**
 * Client-side preview of the totals, submitted for the server to
 * cross-check against its authoritative recompute. Drift → 422
 * `COMMERCIALS_TOTAL_MISMATCH`.
 */
export const claimedTotalsSchema = z.object({
  subtotalMinor: minorAmountSchema,
  discountMinor: minorAmountSchema,
  taxMinor: minorAmountSchema,
  totalMinor: minorAmountSchema,
});
export type ClaimedTotals = z.infer<typeof claimedTotalsSchema>;

export const commercialsBodySchema = z.object({
  items: z.array(commercialsItemInputSchema).min(1).max(200),
  documentDiscount: documentDiscountSchema,
  currency: currencySchema,
  advanceMinor: minorAmountSchema.default(0n),
  validityAt: z.coerce.date().optional(),
  scope: z.string().trim().max(5000).optional(),
  exclusions: z.string().trim().max(5000).optional(),
  timeline: z.string().trim().max(2000).optional(),
  terms: z.string().trim().max(5000).optional(),
  claimedTotals: claimedTotalsSchema.optional(),
});
export type CommercialsBodyInput = z.infer<typeof commercialsBodySchema>;
