import type { AttendanceEventView } from './attendanceApi.js';

/** Exact completed break duration for the employee's workday, excluding a currently open break. */
export function exactCompletedBreakSeconds(events: readonly AttendanceEventView[]): number {
  const effective = events
    .filter((event) => !event.isVoid && (event.kind === 'break-start' || event.kind === 'break-end'))
    .sort((a, b) => Date.parse(a.occurredAt ?? a.at ?? '') - Date.parse(b.occurredAt ?? b.at ?? ''));
  let openAt: number | null = null;
  let total = 0;
  for (const event of effective) {
    const at = Date.parse(event.occurredAt ?? event.at ?? '');
    if (!Number.isFinite(at)) continue;
    if (event.kind === 'break-start') {
      openAt = at;
    } else if (openAt !== null && at >= openAt) {
      total += Math.floor((at - openAt) / 1000);
      openAt = null;
    }
  }
  return total;
}
