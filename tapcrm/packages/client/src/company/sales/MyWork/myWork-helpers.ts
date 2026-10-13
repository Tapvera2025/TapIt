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
}

export interface HandoverLike {
  readonly id: string;
  readonly toUserId: string | null;
  readonly status: string;
}

const ACTIVE_CALLBACK_STATUSES = new Set(['pending', 'rescheduled']);
const NEW_LEAD_STATUSES = new Set(['new', 'assigned']);
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
  /** Owner = me, status new/assigned, created within 24h — need first-contact. */
  readonly newlyAssigned: readonly T[];
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
    if (!NEW_LEAD_STATUSES.has(lead.status)) continue;
    const createdAt = new Date(lead.createdAt).getTime();
    if (createdAt >= cutoff) newlyAssigned.push(lead);
  }
  newlyAssigned.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
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
  return [
    { label: 'Live offers', count: bidPoolCount, urgent: bidPoolCount > 0 },
    { label: 'Overdue', count: overdueCount, urgent: overdueCount > 0 },
    { label: 'Handovers', count: handoverCount, urgent: handoverCount > 0 },
    { label: 'Newly assigned', count: newlyAssignedCount, urgent: newlyAssignedCount > 0 },
    { label: 'Upcoming', count: upcomingCount, urgent: false },
  ];
}
