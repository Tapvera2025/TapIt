import { describe, expect, it } from 'vitest';
import {
  commercialsChecksum,
  type ChecksumInput,
  type ChecksumItem,
} from './checksum.js';

const baseItem: ChecksumItem = {
  serviceName: 'Website redesign',
  description: null,
  quantity: '1',
  unitPriceMinor: 100_000n,
  itemDiscountMinor: 0n,
  taxCategory: 'standard',
  taxRateBps: 1800,
  lineTotalMinor: 100_000n,
  milestone: null,
  sortOrder: 0,
};

const baseInput: ChecksumInput = {
  currency: 'INR',
  subtotalMinor: 100_000n,
  discountMinor: 0n,
  taxMinor: 18_000n,
  totalMinor: 118_000n,
  advanceMinor: 0n,
  validityAt: null,
  scope: null,
  exclusions: null,
  timeline: null,
  terms: null,
  items: [baseItem],
};

describe('commercialsChecksum', () => {
  it('is deterministic — same input twice produces the same hex', () => {
    expect(commercialsChecksum(baseInput)).toBe(commercialsChecksum(baseInput));
  });

  it('is sensitive to total change', () => {
    const altered: ChecksumInput = { ...baseInput, totalMinor: 118_001n };
    expect(commercialsChecksum(altered)).not.toBe(commercialsChecksum(baseInput));
  });

  it('is sensitive to item name change', () => {
    const altered: ChecksumInput = {
      ...baseInput,
      items: [{ ...baseItem, serviceName: 'SEO retainer' }],
    };
    expect(commercialsChecksum(altered)).not.toBe(commercialsChecksum(baseInput));
  });

  it('is insensitive to item order — sort_order is the stable key', () => {
    const second: ChecksumItem = { ...baseItem, serviceName: 'Content', sortOrder: 1 };
    const forward: ChecksumInput = { ...baseInput, items: [baseItem, second] };
    const reversed: ChecksumInput = { ...baseInput, items: [second, baseItem] };
    expect(commercialsChecksum(forward)).toBe(commercialsChecksum(reversed));
  });

  it('is sensitive to scope / exclusions / terms text', () => {
    const scoped: ChecksumInput = { ...baseInput, scope: 'Includes 5 revisions.' };
    const noScope: ChecksumInput = { ...baseInput, scope: null };
    expect(commercialsChecksum(scoped)).not.toBe(commercialsChecksum(noScope));
  });

  it('is sensitive to validity date', () => {
    const dated: ChecksumInput = { ...baseInput, validityAt: new Date('2026-12-01T00:00:00Z') };
    expect(commercialsChecksum(dated)).not.toBe(commercialsChecksum(baseInput));
  });

  it('returns a lowercase hex string of fixed length (64)', () => {
    const hex = commercialsChecksum(baseInput);
    expect(hex).toMatch(/^[0-9a-f]{64}$/);
  });
});
