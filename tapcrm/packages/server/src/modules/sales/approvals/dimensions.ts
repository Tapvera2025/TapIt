/**
 * Sales v1.1 R2 — Approval dimensions (R2 plan step 2.11, R-APP-01).
 *
 * Pure evaluator: given the commercials totals + actor authority, decide
 * which dimensions are in-bounds and which exceed. If any dimension
 * exceeds, approval is required.
 *
 * Dimensions implemented in this step:
 *   - value         — total vs maxValueMinor
 *   - discount      — document+item discount percentage of subtotal vs maxDiscountBps
 *   - advance       — advance / total vs minAdvanceBps
 *   - custom_terms  — commercials carries free-form terms AND actor lacks allowsCustomTerms
 *
 * Margin and non-standard terms (payment schedule, cancellation, etc.)
 * are structured in the plan but deferred until a terms catalog + cost
 * data model exist (R3+).
 */

import { divRoundHalfEven } from '../commercials/math.js';
import { QUANTITY_SCALE } from '../commercials/types.js';
import type { Commercials, CommercialsItemRow } from '../proposals/types.js';
import type {
  ActorAuthority,
  ApprovalDimension,
  ApprovalDimensionsSnapshot,
} from './types.js';

export interface CommercialsForEvaluation {
  readonly subtotalMinor: bigint;
  readonly discountMinor: bigint;
  readonly totalMinor: bigint;
  readonly advanceMinor: bigint;
  readonly terms: string | null;
  /**
   * Sum of per-line gross (quantity × unitPrice) BEFORE any item or
   * document discount. When present, approval dimensions use this as the
   * denominator so item-level discounts can't bypass the policy. When
   * absent, we fall back to subtotal (legacy callers).
   */
  readonly grossSubtotalMinor?: bigint;
}

/**
 * Parse the schema-validated quantity decimal into ×10⁴ bigint micros,
 * mirroring commercials/service.ts `quantityToMicros` without the import
 * cycle risk.
 */
function quantityToMicros(decimal: string): bigint {
  const [integerPart, fractionalPart = ''] = decimal.split('.');
  const padded = (fractionalPart + '0000').slice(0, 4);
  return BigInt((integerPart ?? '0') + padded);
}

/** Per-item gross (pre-item-discount, pre-tax) in minor units. */
function grossItemMinor(item: Pick<CommercialsItemRow, 'quantity' | 'unitPriceMinor'>): bigint {
  const micros = quantityToMicros(item.quantity);
  return divRoundHalfEven(micros * item.unitPriceMinor, QUANTITY_SCALE);
}

/** Sum of per-item gross. Zero when items list is empty. */
export function grossSubtotalMinor(items: readonly Pick<CommercialsItemRow, 'quantity' | 'unitPriceMinor'>[]): bigint {
  let total = 0n;
  for (const item of items) total += grossItemMinor(item);
  return total;
}

/**
 * Compute total applied discount in minor units:
 *   gross − subtotal   = sum of applied item discounts (clamped at line)
 *   + discountMinor    = document-level discount already in the row
 */
export function totalDiscountMinor(c: Pick<CommercialsForEvaluation, 'subtotalMinor' | 'discountMinor' | 'grossSubtotalMinor'>): bigint {
  const gross = c.grossSubtotalMinor ?? c.subtotalMinor;
  const itemsApplied = gross > c.subtotalMinor ? gross - c.subtotalMinor : 0n;
  return itemsApplied + c.discountMinor;
}

/**
 * Discount bps against the gross subtotal — the pre-discount basis the
 * policy intends to compare against. If `grossSubtotalMinor` is omitted
 * the function falls back to the legacy subtotal basis and uses only the
 * document discount, which was the pre-fix behaviour.
 */
export function discountBpsOf(c: Pick<CommercialsForEvaluation, 'subtotalMinor' | 'discountMinor' | 'grossSubtotalMinor'>): number {
  const gross = c.grossSubtotalMinor ?? c.subtotalMinor;
  if (gross <= 0n) return 0;
  const discount = totalDiscountMinor(c);
  const scaled = discount * 10_000n;
  const bps = scaled / gross;
  const rem = scaled - bps * gross;
  const rounded = rem * 2n >= gross ? bps + 1n : bps;
  return Number(rounded);
}

/** Compute advance bps against total; total 0 → 0 (nothing to pay). */
export function advanceBpsOf(c: Pick<CommercialsForEvaluation, 'advanceMinor' | 'totalMinor'>): number {
  if (c.totalMinor <= 0n) return 0;
  const scaled = c.advanceMinor * 10_000n;
  const bps = scaled / c.totalMinor;
  const rem = scaled - bps * c.totalMinor;
  const rounded = rem * 2n >= c.totalMinor ? bps + 1n : bps;
  return Number(rounded);
}

export function evaluateDimensions(
  commercials: CommercialsForEvaluation,
  actor: ActorAuthority,
): ApprovalDimensionsSnapshot {
  const dimensions: ApprovalDimension[] = [];
  const exceeded: ApprovalDimension['kind'][] = [];

  // value
  if (actor.maxValueMinor !== null && commercials.totalMinor > actor.maxValueMinor) {
    dimensions.push({
      kind: 'value',
      status: 'exceeds',
      totalMinor: commercials.totalMinor.toString(),
      limitMinor: actor.maxValueMinor.toString(),
    });
    exceeded.push('value');
  } else {
    dimensions.push({ kind: 'value', status: 'ok' });
  }

  // discount
  const discountBps = discountBpsOf(commercials);
  if (actor.maxDiscountBps !== null && discountBps > actor.maxDiscountBps) {
    dimensions.push({
      kind: 'discount',
      status: 'exceeds',
      discountBps,
      limitBps: actor.maxDiscountBps,
    });
    exceeded.push('discount');
  } else {
    dimensions.push({ kind: 'discount', status: 'ok' });
  }

  // advance
  const advanceBps = advanceBpsOf(commercials);
  if (actor.minAdvanceBps !== null && commercials.totalMinor > 0n && advanceBps < actor.minAdvanceBps) {
    dimensions.push({
      kind: 'advance',
      status: 'below_policy',
      advanceBps,
      policyBps: actor.minAdvanceBps,
    });
    exceeded.push('advance');
  } else {
    dimensions.push({ kind: 'advance', status: 'ok' });
  }

  // custom_terms — a non-empty `terms` field from the commercials counts
  // as "custom" (R-DEAL-06); the actor must hold `allowsCustomTerms` to
  // commit it without approval.
  const hasCustomTerms = Boolean(commercials.terms && commercials.terms.trim().length > 0);
  if (hasCustomTerms && !actor.allowsCustomTerms) {
    dimensions.push({
      kind: 'custom_terms',
      status: 'required',
      reason: 'Actor lacks allowsCustomTerms; approval required for non-standard terms.',
    });
    exceeded.push('custom_terms');
  } else {
    dimensions.push({ kind: 'custom_terms', status: 'ok' });
  }

  return {
    dimensions,
    requiresApproval: exceeded.length > 0,
    exceeded,
  };
}

/** Convenience: evaluate against the loaded commercials row + its items. */
export function evaluateDimensionsForRow(
  row: Pick<Commercials, 'subtotalMinor' | 'discountMinor' | 'totalMinor' | 'advanceMinor' | 'terms' | 'items'>,
  actor: ActorAuthority,
): ApprovalDimensionsSnapshot {
  return evaluateDimensions(
    {
      subtotalMinor: row.subtotalMinor,
      discountMinor: row.discountMinor,
      totalMinor: row.totalMinor,
      advanceMinor: row.advanceMinor,
      terms: row.terms,
      grossSubtotalMinor: grossSubtotalMinor(row.items),
    },
    actor,
  );
}
