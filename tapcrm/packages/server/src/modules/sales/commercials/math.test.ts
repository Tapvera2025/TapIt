/**
 * Sales v1.1 R2 — Commercials math (R2 plan step 2.8).
 *
 * The three mandated test categories:
 *   - Golden table of 20 cases drawn from mixed-tax, mixed-discount shapes.
 *     Each case asserts exact minor-unit totals.
 *   - Floating-point drift — `0.1 + 0.2` family of values produce zero drift
 *     because the pipeline never touches JS `number` for money.
 *   - Half-even rounding: 2.5 rounds to 2, 3.5 rounds to 4.
 */

import { describe, expect, it } from 'vitest';
import {
  applyDocumentDiscount,
  computeCommercials,
  divRoundHalfEven,
  documentTaxMinor,
  lineTotalMinor,
  sumSubtotalMinor,
} from './math.js';
import {
  CommercialsAdvanceTooLargeError,
  CommercialsTotalMismatchError,
  quantityToMicros,
  recompute,
  toMathItem,
} from './service.js';
import type {
  CommercialsItemMath,
  CommercialsMathInput,
  DocumentDiscount,
} from './types.js';
import {
  commercialsBodySchema,
  commercialsItemInputSchema,
  minorAmountSchema,
  quantityDecimalSchema,
} from './validators.js';

const bps = (percent: number) => percent * 100;

/**
 * A compact DSL for test case rows. Prices and discounts are rupee strings
 * for readability; converted to paise bigints at setup time so no case
 * asserts against a `number`.
 */
interface Row {
  readonly name: string;
  readonly items: ReadonlyArray<{
    quantity: string;
    unitPriceRupees: string;
    itemDiscountRupees?: string;
    taxCategory?: string;
    taxRateBps?: number;
  }>;
  readonly documentDiscount?: DocumentDiscount;
  readonly expected: {
    subtotal: bigint;
    discount: bigint;
    tax: bigint;
    total: bigint;
  };
}

const rupeesToMinor = (rupees: string): bigint => {
  const [whole, frac = ''] = rupees.split('.');
  const padded = (frac + '00').slice(0, 2);
  return BigInt((whole ?? '0') + padded);
};

const toMath = (row: Row): CommercialsMathInput => ({
  items: row.items.map<CommercialsItemMath>((i) => ({
    quantityMicros: quantityToMicros(i.quantity),
    unitPriceMinor: rupeesToMinor(i.unitPriceRupees),
    itemDiscountMinor: i.itemDiscountRupees ? rupeesToMinor(i.itemDiscountRupees) : 0n,
    taxCategory: i.taxCategory ?? 'standard',
    taxRateBps: i.taxRateBps ?? 0,
  })),
  documentDiscount: row.documentDiscount ?? { kind: 'none' },
});

/** 20 golden-table rows. Values hand-checked against the R-PROP-02 pipeline. */
const GOLDEN: readonly Row[] = [
  {
    name: 'single item, no tax, no discount',
    items: [{ quantity: '1', unitPriceRupees: '1000.00' }],
    expected: { subtotal: 100_000n, discount: 0n, tax: 0n, total: 100_000n },
  },
  {
    name: 'single item, 18% GST, no discount',
    items: [{ quantity: '1', unitPriceRupees: '1000.00', taxRateBps: bps(18) }],
    expected: { subtotal: 100_000n, discount: 0n, tax: 18_000n, total: 118_000n },
  },
  {
    name: 'two items, mixed tax rates',
    items: [
      { quantity: '2', unitPriceRupees: '500.00', taxRateBps: bps(18) },
      { quantity: '1', unitPriceRupees: '200.00', taxRateBps: bps(5) },
    ],
    expected: { subtotal: 120_000n, discount: 0n, tax: 19_000n, total: 139_000n },
  },
  {
    name: 'fractional quantity (hours), 18% GST',
    items: [{ quantity: '2.5', unitPriceRupees: '400.00', taxRateBps: bps(18) }],
    expected: { subtotal: 100_000n, discount: 0n, tax: 18_000n, total: 118_000n },
  },
  {
    name: 'quantity with 4-digit fractional, 18% GST',
    items: [{ quantity: '1.1234', unitPriceRupees: '1000.00', taxRateBps: bps(18) }],
    expected: { subtotal: 112_340n, discount: 0n, tax: 20_221n, total: 132_561n },
  },
  {
    name: 'item-level discount reduces line total before tax',
    items: [
      {
        quantity: '1',
        unitPriceRupees: '1000.00',
        itemDiscountRupees: '100.00',
        taxRateBps: bps(18),
      },
    ],
    expected: { subtotal: 90_000n, discount: 0n, tax: 16_200n, total: 106_200n },
  },
  {
    name: 'document absolute discount, single tax group',
    items: [{ quantity: '1', unitPriceRupees: '1000.00', taxRateBps: bps(18) }],
    documentDiscount: { kind: 'absolute', amountMinor: 10_000n },
    expected: { subtotal: 100_000n, discount: 10_000n, tax: 16_200n, total: 106_200n },
  },
  {
    name: 'document percent discount, single tax group',
    items: [{ quantity: '1', unitPriceRupees: '1000.00', taxRateBps: bps(18) }],
    documentDiscount: { kind: 'percent', bps: bps(10) },
    expected: { subtotal: 100_000n, discount: 10_000n, tax: 16_200n, total: 106_200n },
  },
  {
    name: 'document percent discount distributes proportionally across tax groups',
    items: [
      { quantity: '1', unitPriceRupees: '1000.00', taxRateBps: bps(18) },
      { quantity: '1', unitPriceRupees: '1000.00', taxRateBps: bps(5) },
    ],
    documentDiscount: { kind: 'percent', bps: bps(10) },
    expected: { subtotal: 200_000n, discount: 20_000n, tax: 20_700n, total: 200_700n },
  },
  {
    name: 'document absolute discount clamped to subtotal',
    items: [{ quantity: '1', unitPriceRupees: '500.00' }],
    documentDiscount: { kind: 'absolute', amountMinor: 1_000_000n },
    expected: { subtotal: 50_000n, discount: 50_000n, tax: 0n, total: 0n },
  },
  {
    name: 'zero-tax item with absolute discount',
    items: [{ quantity: '1', unitPriceRupees: '100.00' }],
    documentDiscount: { kind: 'absolute', amountMinor: 1_000n },
    expected: { subtotal: 10_000n, discount: 1_000n, tax: 0n, total: 9_000n },
  },
  {
    name: 'high-volume items, 18% GST',
    items: [{ quantity: '100', unitPriceRupees: '999.99', taxRateBps: bps(18) }],
    expected: { subtotal: 9_999_900n, discount: 0n, tax: 1_799_982n, total: 11_799_882n },
  },
  {
    name: 'small-unit price with 18% GST — half-even landed on even',
    items: [{ quantity: '1', unitPriceRupees: '0.25', taxRateBps: bps(18) }],
    // subtotal = 25 paise; tax = round(25 × 1800 / 10000) = round(4.5) → 4 (even)
    expected: { subtotal: 25n, discount: 0n, tax: 4n, total: 29n },
  },
  {
    name: 'small-unit price with 18% GST — half-even landed on even (odd side)',
    items: [{ quantity: '1', unitPriceRupees: '0.35', taxRateBps: bps(18) }],
    // subtotal = 35 paise; tax = round(35 × 1800 / 10000) = round(6.3) → 6
    expected: { subtotal: 35n, discount: 0n, tax: 6n, total: 41n },
  },
  {
    name: 'three items, three tax groups, no discount',
    items: [
      { quantity: '1', unitPriceRupees: '100.00', taxRateBps: bps(18) },
      { quantity: '1', unitPriceRupees: '100.00', taxRateBps: bps(12) },
      { quantity: '1', unitPriceRupees: '100.00', taxRateBps: bps(5) },
    ],
    expected: { subtotal: 30_000n, discount: 0n, tax: 3_500n, total: 33_500n },
  },
  {
    name: 'three items, three tax groups, 50% absolute discount',
    items: [
      { quantity: '1', unitPriceRupees: '100.00', taxRateBps: bps(18) },
      { quantity: '1', unitPriceRupees: '100.00', taxRateBps: bps(12) },
      { quantity: '1', unitPriceRupees: '100.00', taxRateBps: bps(5) },
    ],
    documentDiscount: { kind: 'absolute', amountMinor: 15_000n },
    // Each group gets 5000 paise discount proportionally; bases are 5000 each.
    // Tax = 900 + 600 + 250 = 1750.
    expected: { subtotal: 30_000n, discount: 15_000n, tax: 1_750n, total: 16_750n },
  },
  {
    name: 'item discount larger than gross is clamped to zero',
    items: [
      {
        quantity: '1',
        unitPriceRupees: '100.00',
        itemDiscountRupees: '200.00',
        taxRateBps: bps(18),
      },
    ],
    expected: { subtotal: 0n, discount: 0n, tax: 0n, total: 0n },
  },
  {
    name: 'tax rate 0 bps on all items means zero tax regardless of subtotal',
    items: [
      { quantity: '2', unitPriceRupees: '500.00', taxRateBps: 0 },
      { quantity: '1', unitPriceRupees: '750.00', taxRateBps: 0 },
    ],
    expected: { subtotal: 175_000n, discount: 0n, tax: 0n, total: 175_000n },
  },
  {
    name: 'empty-ish shape (one zero-tax item with large subtotal)',
    items: [{ quantity: '1', unitPriceRupees: '12345.67' }],
    expected: { subtotal: 1_234_567n, discount: 0n, tax: 0n, total: 1_234_567n },
  },
  {
    name: 'percent document discount at 100% zeroes totals',
    items: [{ quantity: '1', unitPriceRupees: '1000.00', taxRateBps: bps(18) }],
    documentDiscount: { kind: 'percent', bps: 10_000 },
    expected: { subtotal: 100_000n, discount: 100_000n, tax: 0n, total: 0n },
  },
];

describe('divRoundHalfEven', () => {
  it('rounds down below the halfway point', () => {
    expect(divRoundHalfEven(10n, 3n)).toBe(3n);               // 3.333 → 3
  });
  it('rounds up above the halfway point', () => {
    expect(divRoundHalfEven(11n, 3n)).toBe(4n);               // 3.666 → 4
  });
  it('ties round to even — 2.5 goes down (to 2)', () => {
    expect(divRoundHalfEven(5n, 2n)).toBe(2n);
  });
  it('ties round to even — 3.5 goes up (to 4)', () => {
    expect(divRoundHalfEven(7n, 2n)).toBe(4n);
  });
  it('ties round to even — 0.5 goes to 0', () => {
    expect(divRoundHalfEven(1n, 2n)).toBe(0n);
  });
  it('ties round to even — 1.5 goes to 2', () => {
    expect(divRoundHalfEven(3n, 2n)).toBe(2n);
  });
  it('rejects a non-positive divisor', () => {
    expect(() => divRoundHalfEven(1n, 0n)).toThrow(RangeError);
    expect(() => divRoundHalfEven(1n, -1n)).toThrow(RangeError);
  });
  it('rejects a negative dividend', () => {
    expect(() => divRoundHalfEven(-1n, 2n)).toThrow(RangeError);
  });
});

describe('lineTotalMinor', () => {
  it('rounds (quantity × unitPrice) then subtracts the item discount', () => {
    const line = lineTotalMinor({
      quantityMicros: quantityToMicros('2.5'),
      unitPriceMinor: 40_000n,                // ₹400.00
      itemDiscountMinor: 10_000n,              // ₹100.00
      taxCategory: 'standard',
      taxRateBps: 0,
    });
    expect(line).toBe(90_000n);                // 100000 − 10000
  });
  it('floors a negative post-discount line at zero', () => {
    const line = lineTotalMinor({
      quantityMicros: quantityToMicros('1'),
      unitPriceMinor: 10_000n,
      itemDiscountMinor: 100_000n,
      taxCategory: 'standard',
      taxRateBps: 0,
    });
    expect(line).toBe(0n);
  });
});

describe('applyDocumentDiscount', () => {
  it('clamps an absolute discount to the subtotal', () => {
    expect(applyDocumentDiscount(10_000n, { kind: 'absolute', amountMinor: 50_000n })).toBe(10_000n);
  });
  it('resolves a percent discount via half-even rounding', () => {
    // 10% of 125 paise = 12.5 → 12 (ties to even)
    expect(applyDocumentDiscount(125n, { kind: 'percent', bps: 1000 })).toBe(12n);
  });
  it('returns zero for a zero or negative subtotal', () => {
    expect(applyDocumentDiscount(0n, { kind: 'percent', bps: 1000 })).toBe(0n);
    expect(applyDocumentDiscount(-5n, { kind: 'absolute', amountMinor: 100n })).toBe(0n);
  });
  it('returns zero for the no-discount shape', () => {
    expect(applyDocumentDiscount(10_000n, { kind: 'none' })).toBe(0n);
  });
});

describe('sumSubtotalMinor + documentTaxMinor smoke', () => {
  it('sums line totals without touching document discount', () => {
    const items: CommercialsItemMath[] = [
      {
        quantityMicros: quantityToMicros('1'),
        unitPriceMinor: 100_000n,
        itemDiscountMinor: 0n,
        taxCategory: 'standard',
        taxRateBps: bps(18),
      },
      {
        quantityMicros: quantityToMicros('1'),
        unitPriceMinor: 50_000n,
        itemDiscountMinor: 0n,
        taxCategory: 'standard',
        taxRateBps: bps(5),
      },
    ];
    expect(sumSubtotalMinor(items)).toBe(150_000n);
    expect(documentTaxMinor(150_000n, items, { kind: 'none' })).toBe(18_000n + 2_500n);
  });
});

describe('computeCommercials — golden table', () => {
  for (const row of GOLDEN) {
    it(row.name, () => {
      const result = computeCommercials(toMath(row));
      expect(result.subtotalMinor).toBe(row.expected.subtotal);
      expect(result.discountMinor).toBe(row.expected.discount);
      expect(result.taxMinor).toBe(row.expected.tax);
      expect(result.totalMinor).toBe(row.expected.total);
      // Reconstruct the invariant the DB CHECK enforces.
      expect(result.totalMinor).toBe(result.subtotalMinor - result.discountMinor + result.taxMinor);
    });
  }
});

describe('floating-point drift', () => {
  it('the 0.1 + 0.2 family does not drift through the pipeline', () => {
    // In JS `number`: 0.1 + 0.2 = 0.30000000000000004.
    // We parse the quantity decimal → bigint micros, so 0.1 means 1000n not 0.1.
    expect(quantityToMicros('0.1')).toBe(1_000n);
    expect(quantityToMicros('0.2')).toBe(2_000n);
    const subtotal = computeCommercials({
      items: [
        {
          quantityMicros: quantityToMicros('0.1'),
          unitPriceMinor: 100_00n,                        // ₹100.00
          itemDiscountMinor: 0n,
          taxCategory: 'standard',
          taxRateBps: 0,
        },
        {
          quantityMicros: quantityToMicros('0.2'),
          unitPriceMinor: 100_00n,
          itemDiscountMinor: 0n,
          taxCategory: 'standard',
          taxRateBps: 0,
        },
      ],
      documentDiscount: { kind: 'none' },
    }).subtotalMinor;
    // 0.1 × ₹100 + 0.2 × ₹100 = ₹30.00 = 3000 paise.
    expect(subtotal).toBe(3_000n);
  });
});

describe('quantityToMicros', () => {
  it('left-pads fractional digits to 4', () => {
    expect(quantityToMicros('1')).toBe(10_000n);
    expect(quantityToMicros('1.5')).toBe(15_000n);
    expect(quantityToMicros('1.123')).toBe(11_230n);
    expect(quantityToMicros('1.1234')).toBe(11_234n);
    expect(quantityToMicros('0.0001')).toBe(1n);
  });
});

describe('validator → math integration', () => {
  it('toMathItem converts a schema-validated input', () => {
    const parsed = commercialsItemInputSchema.parse({
      serviceName: 'SEO monthly retainer',
      quantity: '2.5',
      unitPriceMinor: '40000',
      taxRateBps: 1800,
    });
    const math = toMathItem(parsed);
    expect(math.quantityMicros).toBe(25_000n);
    expect(math.unitPriceMinor).toBe(40_000n);
    expect(math.itemDiscountMinor).toBe(0n);
    expect(math.taxCategory).toBe('standard');
    expect(math.taxRateBps).toBe(1800);
  });

  it('minorAmountSchema rejects non-digit strings', () => {
    expect(() => minorAmountSchema.parse('12.5')).toThrow();
    expect(() => minorAmountSchema.parse('-100')).toThrow();
    expect(() => minorAmountSchema.parse('one hundred')).toThrow();
  });

  it('minorAmountSchema accepts bigint, safe integer, and digit string', () => {
    expect(minorAmountSchema.parse(1234n)).toBe(1234n);
    expect(minorAmountSchema.parse(1234)).toBe(1234n);
    expect(minorAmountSchema.parse('1234')).toBe(1234n);
  });

  it('quantityDecimalSchema rejects a quantity with more than 4 fractional digits', () => {
    expect(() => quantityDecimalSchema.parse('1.12345')).toThrow();
    expect(() => quantityDecimalSchema.parse('-1')).toThrow();
    expect(() => quantityDecimalSchema.parse('0')).toThrow();
  });
});

describe('recompute()', () => {
  const baseBody = {
    items: [
      {
        serviceName: 'Website redesign',
        quantity: '1',
        unitPriceMinor: '100000',
        taxRateBps: 1800,
      },
    ],
    documentDiscount: { kind: 'none' as const },
    currency: 'INR',
    advanceMinor: '0',
  };

  it('returns the server-computed totals', () => {
    const body = commercialsBodySchema.parse(baseBody);
    const result = recompute(body);
    expect(result.subtotalMinor).toBe(100_000n);
    expect(result.taxMinor).toBe(18_000n);
    expect(result.totalMinor).toBe(118_000n);
  });

  it('passes when claimedTotals match the server math', () => {
    const body = commercialsBodySchema.parse({
      ...baseBody,
      claimedTotals: {
        subtotalMinor: '100000',
        discountMinor: '0',
        taxMinor: '18000',
        totalMinor: '118000',
      },
    });
    expect(() => recompute(body)).not.toThrow();
  });

  it('throws COMMERCIALS_TOTAL_MISMATCH when claimedTotals drift from the server math', () => {
    const body = commercialsBodySchema.parse({
      ...baseBody,
      claimedTotals: {
        subtotalMinor: '100000',
        discountMinor: '0',
        taxMinor: '17999',                    // off by one
        totalMinor: '117999',
      },
    });
    try {
      recompute(body);
      expect.fail('expected CommercialsTotalMismatchError');
    } catch (err) {
      expect(err).toBeInstanceOf(CommercialsTotalMismatchError);
      expect((err as CommercialsTotalMismatchError).code).toBe('COMMERCIALS_TOTAL_MISMATCH');
    }
  });

  it('throws COMMERCIALS_ADVANCE_EXCEEDS_TOTAL when advance > total', () => {
    const body = commercialsBodySchema.parse({
      ...baseBody,
      advanceMinor: '200000',
    });
    try {
      recompute(body);
      expect.fail('expected CommercialsAdvanceTooLargeError');
    } catch (err) {
      expect(err).toBeInstanceOf(CommercialsAdvanceTooLargeError);
      expect((err as CommercialsAdvanceTooLargeError).code).toBe('COMMERCIALS_ADVANCE_EXCEEDS_TOTAL');
    }
  });
});
