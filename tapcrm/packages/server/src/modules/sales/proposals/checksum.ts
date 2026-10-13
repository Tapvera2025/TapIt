/**
 * Sales v1.1 R2 — Commercials PDF checksum (R2 plan step 2.9).
 *
 * The "PDF" doesn't exist as a real file yet (file-generation lands with
 * the public portal in step 2.10). The checksum is instead a stable
 * fingerprint of the frozen content: currency, totals, document discount,
 * every item, and every string field that appears on the proposal. Two
 * publish calls on the same version data produce the same checksum,
 * which is how we make republish a no-op.
 */

import { createHash } from 'node:crypto';
import type { CommercialsItemRow } from './types.js';

export interface ChecksumInput {
  readonly currency: string;
  readonly subtotalMinor: bigint;
  readonly discountMinor: bigint;
  readonly taxMinor: bigint;
  readonly totalMinor: bigint;
  readonly advanceMinor: bigint;
  readonly validityAt: Date | null;
  readonly scope: string | null;
  readonly exclusions: string | null;
  readonly timeline: string | null;
  readonly terms: string | null;
  readonly items: readonly ChecksumItem[];
}

export interface ChecksumItem {
  readonly serviceName: string;
  readonly description: string | null;
  readonly quantity: string;
  readonly unitPriceMinor: bigint;
  readonly itemDiscountMinor: bigint;
  readonly taxCategory: string;
  readonly taxRateBps: number;
  readonly lineTotalMinor: bigint;
  readonly milestone: string | null;
  readonly sortOrder: number;
}

function canonical(input: ChecksumInput): string {
  const parts: string[] = [
    `v1`,
    `currency=${input.currency}`,
    `subtotal=${input.subtotalMinor.toString()}`,
    `discount=${input.discountMinor.toString()}`,
    `tax=${input.taxMinor.toString()}`,
    `total=${input.totalMinor.toString()}`,
    `advance=${input.advanceMinor.toString()}`,
    `validity=${input.validityAt ? input.validityAt.toISOString() : ''}`,
    `scope=${input.scope ?? ''}`,
    `exclusions=${input.exclusions ?? ''}`,
    `timeline=${input.timeline ?? ''}`,
    `terms=${input.terms ?? ''}`,
  ];
  const items = [...input.items].sort((a, b) => a.sortOrder - b.sortOrder || a.serviceName.localeCompare(b.serviceName));
  for (const item of items) {
    parts.push(
      [
        'item',
        item.sortOrder,
        item.serviceName,
        item.description ?? '',
        item.quantity,
        item.unitPriceMinor.toString(),
        item.itemDiscountMinor.toString(),
        item.taxCategory,
        item.taxRateBps.toString(),
        item.lineTotalMinor.toString(),
        item.milestone ?? '',
      ].join('|'),
    );
  }
  return parts.join('\n');
}

export function commercialsChecksum(input: ChecksumInput): string {
  return createHash('sha256').update(canonical(input)).digest('hex');
}

/**
 * Adapter from the row shape so callers can hand `Commercials` straight in
 * without re-mapping fields.
 */
export function commercialsRowToChecksumInput(row: {
  currency: string;
  subtotalMinor: bigint;
  discountMinor: bigint;
  taxMinor: bigint;
  totalMinor: bigint;
  advanceMinor: bigint;
  validityAt: Date | null;
  scope: string | null;
  exclusions: string | null;
  timeline: string | null;
  terms: string | null;
  items: readonly CommercialsItemRow[];
}): ChecksumInput {
  return {
    currency: row.currency,
    subtotalMinor: row.subtotalMinor,
    discountMinor: row.discountMinor,
    taxMinor: row.taxMinor,
    totalMinor: row.totalMinor,
    advanceMinor: row.advanceMinor,
    validityAt: row.validityAt,
    scope: row.scope,
    exclusions: row.exclusions,
    timeline: row.timeline,
    terms: row.terms,
    items: row.items.map((i) => ({
      serviceName: i.serviceName,
      description: i.description,
      quantity: i.quantity,
      unitPriceMinor: i.unitPriceMinor,
      itemDiscountMinor: i.itemDiscountMinor,
      taxCategory: i.taxCategory,
      taxRateBps: i.taxRateBps,
      lineTotalMinor: i.lineTotalMinor,
      milestone: i.milestone,
      sortOrder: i.sortOrder,
    })),
  };
}
