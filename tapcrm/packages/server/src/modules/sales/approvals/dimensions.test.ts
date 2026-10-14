import { describe, expect, it } from 'vitest';
import {
  advanceBpsOf,
  discountBpsOf,
  evaluateDimensions,
} from './dimensions.js';
import type { ActorAuthority } from './types.js';

const unlimited: ActorAuthority = {
  maxValueMinor: null,
  maxDiscountBps: null,
  minAdvanceBps: null,
  allowsCustomTerms: true,
};

const juniorAgent: ActorAuthority = {
  maxValueMinor: 500_000_00n,       // ₹5,00,000 (500000 rupees in paise)
  maxDiscountBps: 1_000,              // 10%
  minAdvanceBps: 5_000,               // 50% advance required
  allowsCustomTerms: false,
};

describe('discountBpsOf', () => {
  it('returns 0 when subtotal is zero', () => {
    expect(discountBpsOf({ subtotalMinor: 0n, discountMinor: 100n })).toBe(0);
  });
  it('computes 10% correctly (document-level only, no gross passed)', () => {
    expect(discountBpsOf({ subtotalMinor: 100_000n, discountMinor: 10_000n })).toBe(1000);
  });
  it('rounds half-up', () => {
    expect(discountBpsOf({ subtotalMinor: 10_000n, discountMinor: 125n })).toBe(125);
  });

  // Fix for the item-discount bypass: gross must drive the ratio.
  it('counts item-level discounts when grossSubtotal is supplied', () => {
    // One line, gross ₹1000, item discount ₹900 → subtotal ₹100.
    // Applied discount = 1000 − 100 + 0 = 900 against gross 1000 → 9000 bps.
    expect(
      discountBpsOf({
        grossSubtotalMinor: 100_000n,
        subtotalMinor: 10_000n,
        discountMinor: 0n,
      }),
    ).toBe(9000);
  });

  it('combines item-level and document discounts', () => {
    // Gross ₹1000. Item discount ₹400 → subtotal ₹600. Doc discount ₹60.
    // Applied discount = 400 + 60 = 460 against gross 1000 → 4600 bps.
    expect(
      discountBpsOf({
        grossSubtotalMinor: 100_000n,
        subtotalMinor: 60_000n,
        discountMinor: 6_000n,
      }),
    ).toBe(4600);
  });
});

describe('advanceBpsOf', () => {
  it('returns 0 when total is zero', () => {
    expect(advanceBpsOf({ totalMinor: 0n, advanceMinor: 500n })).toBe(0);
  });
  it('computes 50% correctly', () => {
    expect(advanceBpsOf({ totalMinor: 200_000n, advanceMinor: 100_000n })).toBe(5000);
  });
});

describe('evaluateDimensions — unlimited actor', () => {
  it('requires no approval when all limits are null', () => {
    const snap = evaluateDimensions(
      { subtotalMinor: 1_000_000n, discountMinor: 500_000n, totalMinor: 500_000n, advanceMinor: 0n, terms: null },
      unlimited,
    );
    expect(snap.requiresApproval).toBe(false);
    expect(snap.exceeded).toEqual([]);
  });
});

describe('evaluateDimensions — junior agent', () => {
  const baseline = {
    subtotalMinor: 100_000n,
    discountMinor: 10_000n,
    totalMinor: 100_000n,
    advanceMinor: 50_000n,
    terms: null,
  };

  it('no exceeds when every dimension is within limits', () => {
    const snap = evaluateDimensions(baseline, juniorAgent);
    expect(snap.requiresApproval).toBe(false);
    expect(snap.exceeded).toEqual([]);
  });

  it('value exceeds when total > maxValueMinor', () => {
    const snap = evaluateDimensions(
      { ...baseline, totalMinor: 600_000_00n, subtotalMinor: 600_000_00n, advanceMinor: 300_000_00n },
      juniorAgent,
    );
    expect(snap.exceeded).toContain('value');
    const value = snap.dimensions.find((d) => d.kind === 'value')!;
    expect(value.status).toBe('exceeds');
  });

  it('discount exceeds when discount percentage > maxDiscountBps', () => {
    const snap = evaluateDimensions(
      { ...baseline, discountMinor: 20_000n, totalMinor: 80_000n, advanceMinor: 40_000n },
      juniorAgent,
    );
    expect(snap.exceeded).toContain('discount');
  });

  it('advance below_policy when advance share < minAdvanceBps', () => {
    const snap = evaluateDimensions(
      { ...baseline, advanceMinor: 10_000n },
      juniorAgent,
    );
    expect(snap.exceeded).toContain('advance');
  });

  it('custom_terms required when terms set and actor cannot grant', () => {
    const snap = evaluateDimensions(
      { ...baseline, terms: 'Net 90 payment, non-refundable advance' },
      juniorAgent,
    );
    expect(snap.exceeded).toContain('custom_terms');
  });

  it('custom_terms ok when terms set and actor allowsCustomTerms', () => {
    const snap = evaluateDimensions(
      { ...baseline, terms: 'Standard terms' },
      { ...juniorAgent, allowsCustomTerms: true },
    );
    expect(snap.exceeded).not.toContain('custom_terms');
  });

  it('reports every exceeded dimension in one evaluation', () => {
    const snap = evaluateDimensions(
      {
        subtotalMinor: 1_000_000_00n,
        discountMinor: 300_000_00n,              // 30%
        totalMinor: 800_000_00n,                 // > 500000₹
        advanceMinor: 0n,                        // below 50% policy
        terms: 'Net 90',
      },
      juniorAgent,
    );
    expect(new Set(snap.exceeded)).toEqual(new Set(['value', 'discount', 'advance', 'custom_terms']));
    expect(snap.requiresApproval).toBe(true);
  });
});
