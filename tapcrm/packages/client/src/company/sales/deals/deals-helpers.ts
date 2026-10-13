/**
 * Pure helpers for the deals UI (R2 plan step 2.16). Split from React
 * so the stage/transition/label math is unit-testable.
 */

import type {
  Deal,
  DealApprovalStatus,
  DealContractStatus,
  DealLifecycleStatus,
  DealLossReason,
  DealPaymentStatus,
  DealStage,
} from './api.js';

export const DEAL_STAGES: readonly DealStage[] = [
  'discovery',
  'proposal',
  'negotiation',
  'closing',
  'closed',
];

export const OPEN_DEAL_STAGES: readonly DealStage[] = [
  'discovery',
  'proposal',
  'negotiation',
  'closing',
];

export const STAGE_LABELS: Record<DealStage, string> = {
  discovery: 'Discovery',
  proposal: 'Proposal',
  negotiation: 'Negotiation',
  closing: 'Closing',
  closed: 'Closed',
};

export const LIFECYCLE_LABELS: Record<DealLifecycleStatus, string> = {
  open: 'Open',
  won: 'Won',
  lost: 'Lost',
  cancelled: 'Cancelled',
};

export const APPROVAL_LABELS: Record<DealApprovalStatus, string> = {
  not_required: 'Not required',
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
};

export const CONTRACT_LABELS: Record<DealContractStatus, string> = {
  not_required: 'Not required',
  draft: 'Draft',
  sent: 'Sent',
  signed: 'Signed',
  voided: 'Voided',
};

export const PAYMENT_LABELS: Record<DealPaymentStatus, string> = {
  unpaid: 'Unpaid',
  partial: 'Partial',
  advance_confirmed: 'Advance confirmed',
  paid: 'Paid',
  partially_refunded: 'Partially refunded',
  refunded: 'Refunded',
};

export const LOSS_REASON_LABELS: Record<DealLossReason, string> = {
  not_interested: 'Not interested',
  no_budget: 'No budget',
  no_need: 'No need',
  competitor: 'Lost to competitor',
  timing: 'Bad timing',
  unqualified: 'Unqualified',
  duplicate: 'Duplicate',
  other: 'Other',
};

export type BadgeTone = 'neutral' | 'info' | 'warning' | 'success' | 'danger';

export function stageTone(stage: DealStage): BadgeTone {
  switch (stage) {
    case 'discovery':
      return 'neutral';
    case 'proposal':
      return 'info';
    case 'negotiation':
      return 'warning';
    case 'closing':
      return 'warning';
    case 'closed':
      return 'success';
  }
}

export function lifecycleTone(status: DealLifecycleStatus): BadgeTone {
  switch (status) {
    case 'open':
      return 'info';
    case 'won':
      return 'success';
    case 'lost':
      return 'danger';
    case 'cancelled':
      return 'neutral';
  }
}

export function approvalTone(status: DealApprovalStatus): BadgeTone {
  switch (status) {
    case 'approved':
      return 'success';
    case 'pending':
      return 'warning';
    case 'rejected':
      return 'danger';
    case 'not_required':
      return 'neutral';
  }
}

export function contractTone(status: DealContractStatus): BadgeTone {
  switch (status) {
    case 'signed':
      return 'success';
    case 'sent':
      return 'info';
    case 'draft':
      return 'warning';
    case 'voided':
      return 'danger';
    case 'not_required':
      return 'neutral';
  }
}

export function paymentTone(status: DealPaymentStatus): BadgeTone {
  switch (status) {
    case 'paid':
    case 'advance_confirmed':
      return 'success';
    case 'partial':
      return 'info';
    case 'unpaid':
      return 'warning';
    case 'partially_refunded':
    case 'refunded':
      return 'danger';
  }
}

const FORWARD_ORDER: readonly DealStage[] = ['discovery', 'proposal', 'negotiation', 'closing'];

/**
 * Mirrors `isLegalStageTransition` on the server (deals/state-machine.ts).
 * - Forward moves are one stage at a time.
 * - Backwards moves to any earlier non-closed stage are allowed.
 * - Transitions to `closed` are never user-driven (Won recorder owns it).
 */
export function isStageTransitionAllowed(from: DealStage, to: DealStage): boolean {
  if (from === 'closed' || to === 'closed') return false;
  if (from === to) return true;
  const fromIdx = FORWARD_ORDER.indexOf(from);
  const toIdx = FORWARD_ORDER.indexOf(to);
  if (fromIdx < 0 || toIdx < 0) return false;
  if (toIdx === fromIdx + 1) return true;
  return toIdx < fromIdx;
}

export function nextStageOptions(from: DealStage): readonly DealStage[] {
  return FORWARD_ORDER.filter((candidate) => candidate !== from && isStageTransitionAllowed(from, candidate));
}

/** Group open deals by stage, in canonical order, for the kanban view. */
export function groupByStage(deals: readonly Deal[]): ReadonlyArray<{ stage: DealStage; deals: readonly Deal[] }> {
  const buckets = new Map<DealStage, Deal[]>(OPEN_DEAL_STAGES.map((stage) => [stage, []]));
  for (const deal of deals) {
    if (deal.lifecycleStatus !== 'open') continue;
    const bucket = buckets.get(deal.dealStage);
    if (bucket) bucket.push(deal);
  }
  return OPEN_DEAL_STAGES.map((stage) => ({ stage, deals: buckets.get(stage) ?? [] }));
}

/**
 * Convert a month input (e.g. `"2026-10"`) into an inclusive from/exclusive to
 * ISO-string pair for the list query. Returns null if the input isn't parseable.
 */
export function monthToRange(month: string): { from: string; to: string } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) return null;
  const year = Number(match[1]);
  const monthIdx = Number(match[2]) - 1;
  if (monthIdx < 0 || monthIdx > 11) return null;
  const from = new Date(Date.UTC(year, monthIdx, 1));
  const to = new Date(Date.UTC(year, monthIdx + 1, 1));
  return { from: from.toISOString(), to: to.toISOString() };
}

export function formatCurrencyLabel(currency: string): string {
  const code = currency.toUpperCase();
  if (code === 'INR') return '₹';
  if (code === 'USD') return '$';
  if (code === 'EUR') return '€';
  if (code === 'GBP') return '£';
  return `${code} `;
}

export function formatProbability(deal: Deal): string {
  if (deal.probabilityOverride !== null) return `${deal.probabilityOverride}%`;
  switch (deal.dealStage) {
    case 'discovery':
      return '10%';
    case 'proposal':
      return '25%';
    case 'negotiation':
      return '50%';
    case 'closing':
      return '75%';
    case 'closed':
      return deal.lifecycleStatus === 'won' ? '100%' : '0%';
  }
}

export function formatRelativeDate(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
