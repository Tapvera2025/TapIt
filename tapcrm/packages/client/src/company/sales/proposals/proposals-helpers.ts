/**
 * Pure helpers for the proposals UI (R2 plan step 2.17). Split from React
 * so money parsing, state labels, and share-link URL building are
 * unit-testable.
 */

import type { CommercialsState } from './api.js';

export const COMMERCIALS_STATE_LABELS: Record<CommercialsState, string> = {
  draft: 'Draft',
  published: 'Published',
  superseded: 'Superseded',
  expired: 'Expired',
  accepted: 'Accepted',
  rejected: 'Rejected',
};

export type BadgeTone = 'neutral' | 'info' | 'warning' | 'success' | 'danger';

export function commercialsStateTone(state: CommercialsState): BadgeTone {
  switch (state) {
    case 'draft':
      return 'warning';
    case 'published':
      return 'info';
    case 'accepted':
      return 'success';
    case 'rejected':
    case 'expired':
      return 'danger';
    case 'superseded':
      return 'neutral';
  }
}

/** Only draft rows accept writes. */
export function isDraftEditable(state: CommercialsState): boolean {
  return state === 'draft';
}

/**
 * Parse a user-entered rupee amount like `"1234.56"` into bigint paise.
 * Returns `null` on malformed input (empty, non-numeric, more than 2 decimal
 * places, or negative). Used for every money input in the editor — the
 * server owns math, we just serialize digits.
 */
export function rupeesToPaise(input: string): bigint | null {
  const trimmed = input.trim();
  if (trimmed === '') return null;
  if (!/^\d+(?:\.\d{1,2})?$/.test(trimmed)) return null;
  const [whole, fraction = ''] = trimmed.split('.');
  const paddedFraction = (fraction + '00').slice(0, 2);
  try {
    return BigInt((whole ?? '0') + paddedFraction);
  } catch {
    return null;
  }
}

/**
 * Format bigint paise as a locale-aware string with 2 decimal digits, no
 * currency symbol (so callers can prefix the symbol separately).
 */
export function paiseToRupees(amount: bigint): string {
  const negative = amount < 0n;
  const abs = negative ? -amount : amount;
  const whole = abs / 100n;
  const fraction = abs % 100n;
  const wholeStr = whole.toString();
  const withCommas = wholeStr.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const fractionStr = fraction.toString().padStart(2, '0');
  return `${negative ? '-' : ''}${withCommas}.${fractionStr}`;
}

export function currencySymbol(currency: string): string {
  const code = currency.toUpperCase();
  if (code === 'INR') return '₹';
  if (code === 'USD') return '$';
  if (code === 'EUR') return '€';
  if (code === 'GBP') return '£';
  return `${code} `;
}

/** `100` → `"1.00"` for display of basis points as a percentage. */
export function bpsToPercent(bps: number): string {
  const whole = Math.floor(bps / 100);
  const fraction = (bps % 100).toString().padStart(2, '0');
  return `${whole}.${fraction}`;
}

/** `"18"` or `"18.5"` → 1850 bps (or `null` on malformed input). */
export function percentToBps(input: string): number | null {
  const trimmed = input.trim();
  if (trimmed === '') return null;
  if (!/^\d+(?:\.\d{1,2})?$/.test(trimmed)) return null;
  const [whole, fraction = ''] = trimmed.split('.');
  const paddedFraction = (fraction + '00').slice(0, 2);
  const bps = Number(whole ?? '0') * 100 + Number(paddedFraction);
  if (bps > 10_000 || Number.isNaN(bps)) return null;
  return bps;
}

/**
 * Build the public portal URL for the proposal portal. Uses the current
 * window.location.origin at call time.
 */
export function portalUrl(portalPath: string): string {
  if (typeof window === 'undefined') return portalPath;
  return `${window.location.origin}${portalPath}`;
}
