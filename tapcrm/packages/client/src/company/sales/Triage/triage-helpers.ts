/**
 * Pure helpers for the triage queue UI (R1 plan step 1.16).
 */

export function formatAge(ageSeconds: number): string {
  const seconds = Math.max(0, Math.round(ageSeconds));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  return `${days}d`;
}

const KNOWN_REASON_LABELS: Readonly<Record<string, string>> = {
  bid_pool_timeout_no_fallback: 'No eligible agents after pool timeout',
  bid_pool_timeout_fallback_router: 'Fallback assignment attempted',
  review_queue_from_email: 'Email classifier flagged for review',
  ambiguous_classification: 'Classifier was uncertain',
  no_eligible_agents: 'No eligible agents at intake',
};

export function labelForReason(reason: string | null): string {
  if (!reason) return 'Needs review';
  if (reason.startsWith('triage_rescue')) return 'Rescue attempted';
  if (reason.startsWith('bid_pool_timeout')) return KNOWN_REASON_LABELS[reason] ?? 'Bid pool timed out';
  return KNOWN_REASON_LABELS[reason] ?? reason.replaceAll('_', ' ');
}

export interface TriageActionGate {
  readonly canRescue: boolean;
  readonly canReturnToPool: boolean;
  readonly canClose: boolean;
}

/**
 * Any viewer who can see the queue can run the three actions in R1 —
 * the server policy `leads:rescue-from-triage` is the real gate. The
 * client only hides buttons for users who cannot even reach the page.
 */
export function gateFor(_role: 'super-admin' | 'hod' | 'supervisor' | 'other'): TriageActionGate {
  return { canRescue: true, canReturnToPool: true, canClose: true };
}
