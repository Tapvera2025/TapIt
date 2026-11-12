/**
 * Pure helpers for the My Work dashboard (R1 plan step 1.14).
 *
 * Each section wants a specific slice of the data owned by other
 * modules (callbacks, handovers, leads, bid pool). These partitioners
 * run against snapshots the sections already fetch, so there is no
 * duplicate network traffic.
 */

export interface CallbackLike {
  readonly id: string;
  readonly scheduledAt: string;
  readonly status: string;
  readonly ownerId: string;
}

export interface LeadLike {
  readonly id: string;
  readonly ownerId: string | null;
  readonly status: string;
  readonly routingStatus: string;
  readonly createdAt: string;
  readonly updatedAt?: string;
  /** When the current owner got the lead. */
  readonly assignedAt?: string | null;
}

export interface HandoverLike {
  readonly id: string;
  readonly toUserId: string | null;
  readonly status: string;
}

// Rescheduling closes the old callback as 'rescheduled' and books a new
// pending one, so only 'pending' is still waiting on the agent.
const ACTIVE_CALLBACK_STATUSES = new Set(['pending']);
const NEW_LEAD_STATUSES = new Set(['new', 'assigned']);
const CLOSED_LEAD_STATUSES = new Set(['converted', 'closed_lost']);
const UPCOMING_WINDOW_MS = 24 * 60 * 60 * 1000;
const RECENTLY_ASSIGNED_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface PartitionedCallbacks<T extends CallbackLike> {
  readonly overdue: readonly T[];
  readonly upcomingToday: readonly T[];
}

export function partitionCallbacks<T extends CallbackLike>(
  callbacks: readonly T[],
  userId: string,
  now: Date = new Date(),
): PartitionedCallbacks<T> {
  const nowMs = now.getTime();
  const horizon = nowMs + UPCOMING_WINDOW_MS;
  const overdue: T[] = [];
  const upcomingToday: T[] = [];
  for (const callback of callbacks) {
    if (!ACTIVE_CALLBACK_STATUSES.has(callback.status)) continue;
    if (callback.ownerId !== userId) continue;
    const scheduledAt = new Date(callback.scheduledAt).getTime();
    if (scheduledAt < nowMs) overdue.push(callback);
    else if (scheduledAt <= horizon) upcomingToday.push(callback);
  }
  overdue.sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());
  upcomingToday.sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());
  return { overdue, upcomingToday };
}

export interface PartitionedLeads<T extends LeadLike> {
  /**
   * Owner = me, given to me within 24h, and waiting on first contact: still
   * new/assigned, or handed over mid-way and not touched since (PRD
   * R-REASSIGN-04).
   */
  readonly newlyAssigned: readonly T[];
}

/** When the current owner got the lead (older data has only the creation time). */
export function assignedTime(lead: LeadLike): number {
  return new Date(lead.assignedAt ?? lead.createdAt).getTime();
}

export function partitionLeads<T extends LeadLike>(
  leads: readonly T[],
  userId: string,
  now: Date = new Date(),
): PartitionedLeads<T> {
  const nowMs = now.getTime();
  const cutoff = nowMs - RECENTLY_ASSIGNED_WINDOW_MS;
  const newlyAssigned: T[] = [];
  for (const lead of leads) {
    if (lead.ownerId !== userId) continue;
    if (CLOSED_LEAD_STATUSES.has(lead.status)) continue;
    const assignedAt = assignedTime(lead);
    if (assignedAt < cutoff) continue;
    // Any change after the hand-over (a status, a callback) means it was picked up.
    const untouched =
      lead.updatedAt !== undefined && new Date(lead.updatedAt).getTime() <= assignedAt;
    if (NEW_LEAD_STATUSES.has(lead.status) || untouched) newlyAssigned.push(lead);
  }
  newlyAssigned.sort((a, b) => assignedTime(b) - assignedTime(a));
  return { newlyAssigned };
}

export interface PartitionedHandovers<T extends HandoverLike> {
  readonly pendingForMe: readonly T[];
}

export function partitionHandovers<T extends HandoverLike>(
  handovers: readonly T[],
  userId: string,
): PartitionedHandovers<T> {
  const pendingForMe: T[] = [];
  for (const handover of handovers) {
    if (handover.status !== 'pending') continue;
    if (handover.toUserId !== null && handover.toUserId !== userId) continue;
    pendingForMe.push(handover);
  }
  return { pendingForMe };
}

/**
 * "in 23 min", "in 4h", "2h ago", "yesterday". Deterministic for tests.
 */
export function relativeTime(targetIso: string, now: Date = new Date()): string {
  const target = new Date(targetIso).getTime();
  const diffSeconds = Math.round((target - now.getTime()) / 1000);
  const absSeconds = Math.abs(diffSeconds);
  if (absSeconds < 60) return diffSeconds >= 0 ? 'in a moment' : 'just now';
  const minutes = Math.round(absSeconds / 60);
  if (minutes < 60) return diffSeconds >= 0 ? `in ${minutes} min` : `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return diffSeconds >= 0 ? `in ${hours}h` : `${hours}h ago`;
  const days = Math.round(hours / 24);
  return diffSeconds >= 0 ? `in ${days}d` : `${days}d ago`;
}

export interface SectionCount {
  readonly label: string;
  readonly count: number;
  /** True if the count represents something the user must act on now. */
  readonly urgent: boolean;
}

export function summarize(
  bidPoolCount: number,
  overdueCount: number,
  handoverCount: number,
  newlyAssignedCount: number,
  upcomingCount: number,
): readonly SectionCount[] {
  // Same order as the page: a customer on the line first, then promises
  // already due, then new leads, then optional new work from the pool.
  return [
    { label: 'Live calls', count: handoverCount, urgent: handoverCount > 0 },
    { label: 'Overdue callbacks', count: overdueCount, urgent: overdueCount > 0 },
    { label: 'New leads to call', count: newlyAssignedCount, urgent: newlyAssignedCount > 0 },
    { label: 'Bid Pool', count: bidPoolCount, urgent: bidPoolCount > 0 },
    { label: 'Coming up', count: upcomingCount, urgent: false },
  ];
}
