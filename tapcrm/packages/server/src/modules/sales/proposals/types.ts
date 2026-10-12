/**
 * Sales v1.1 R2 — Proposal (Commercials) row types (R2 plan step 2.9).
 *
 * The row materialised from migrations/0080_sales_commercials.sql. All
 * money is bigint minor units (paise); the DB stores `bigint` so the
 * values survive JSON transport as strings (never number).
 */

import type { CommercialsState } from '../commercials/types.js';

export interface CommercialsItemRow {
  readonly id: string;
  readonly commercialsId: string;
  readonly serviceName: string;
  readonly description: string | null;
  readonly quantity: string;                      // numeric(14,4) as decimal string from pg
  readonly unitPriceMinor: bigint;
  readonly itemDiscountMinor: bigint;
  readonly taxCategory: string;
  readonly taxRateBps: number;
  readonly lineTotalMinor: bigint;
  readonly milestone: string | null;
  readonly sortOrder: number;
}

export interface Commercials {
  readonly id: string;
  readonly organizationId: string;
  readonly dealId: string;
  readonly version: number;
  readonly state: CommercialsState;
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
  readonly pdfChecksum: string | null;
  readonly publishedAt: Date | null;
  readonly publishedBy: string | null;
  readonly acceptedAt: Date | null;
  readonly createdBy: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly items: readonly CommercialsItemRow[];
}
