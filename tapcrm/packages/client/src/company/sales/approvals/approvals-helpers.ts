/**
 * Pure helpers for the approvals UI (R2 plan step 2.18). Split from React
 * so SLA math and dimension label mapping are unit-testable.
 */

import type { ApprovalDimension, ApprovalState } from './api.js';

export const BREACH_THRESHOLD_SECONDS = 15 * 60;        // red badge when <15 min remain

export type SlaSeverity = 'ok' | 'warn' | 'breach' | 'overdue';

export interface SlaView {
  readonly secondsRemaining: number;
  readonly severity: SlaSeverity;
  readonly label: string;
}

/**
 * Compute SLA presentation from `slaDueAt` iso. `warn` kicks in with ≤60 min
 * remaining; `breach` at ≤15 min; `overdue` once we pass the due instant.
 */
export function describeSla(slaDueAtIso: string, now: Date = new Date()): SlaView {
  const due = new Date(slaDueAtIso).getTime();
  const seconds = Math.round((due - now.getTime()) / 1000);
  if (seconds <= 0) {
    return { secondsRemaining: 0, severity: 'overdue', label: 'Overdue' };
  }
  const label = formatSeconds(seconds);
  if (seconds <= BREACH_THRESHOLD_SECONDS) return { secondsRemaining: seconds, severity: 'breach', label };
  if (seconds <= 60 * 60) return { secondsRemaining: seconds, severity: 'warn', label };
  return { secondsRemaining: seconds, severity: 'ok', label };
}

function formatSeconds(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export const APPROVAL_STATE_LABELS: Record<ApprovalState, string> = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
  returned: 'Returned',
  escalated: 'Escalated',
  cancelled: 'Cancelled',
  invalidated: 'Invalidated',
};

export function describeDimension(dim: ApprovalDimension): string {
  if (dim.status === 'ok') {
    switch (dim.kind) {
      case 'value':
        return 'Value within authority';
      case 'discount':
        return 'Discount within authority';
      case 'advance':
        return 'Advance within policy';
      case 'custom_terms':
        return 'Standard terms';
    }
  }
  switch (dim.kind) {
    case 'value':
      return `Value exceeds — total ${formatPaiseShort(dim.totalMinor)} vs limit ${formatPaiseShort(dim.limitMinor)}`;
    case 'discount':
      return `Discount exceeds — ${(dim.discountBps / 100).toFixed(2)}% vs limit ${(dim.limitBps / 100).toFixed(2)}%`;
    case 'advance':
      return `Advance below policy — ${(dim.advanceBps / 100).toFixed(2)}% vs policy ${(dim.policyBps / 100).toFixed(2)}%`;
    case 'custom_terms':
      return `Custom terms required: ${dim.reason}`;
  }
}

/** Only exceeded dimensions warrant a badge in the queue card. */
export function exceededDimensions(dims: readonly ApprovalDimension[]): readonly ApprovalDimension[] {
  return dims.filter((d) => d.status !== 'ok');
}

/**
 * Short formatting of a bigint-ish paise string into a lakh/rupee display
 * ("₹2,00,000"). Not a general money helper — just for the dimension
 * description preview.
 */
function formatPaiseShort(minor: string): string {
  try {
    const paise = BigInt(minor);
    const whole = paise / 100n;
    return `₹${whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
  } catch {
    return minor;
  }
}
