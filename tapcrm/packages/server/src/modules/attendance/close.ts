import type { AttendanceEventInput, EligibilityWindow } from '@tapcrm/contracts';
import { compareEvents, readDay } from '@tapcrm/contracts';

export type CloseDecision =
  | { readonly kind: 'real-departure' }
  | { readonly kind: 'still-open' }
  | { readonly kind: 'no-show' }
  | { readonly kind: 'auto-out'; readonly at: Date; readonly basis: 'last-scan' | 'shift-end' | 'last-event' };

/**
 * Pure closure decision — §12.3. Caller supplies the day's effective events
 * WITHOUT the day's own auto-out (attribution ignores auto-outs; excluding them
 * here prevents re-derivation from ever looping).
 *
 * `window` is the eligibility window, whose `to` is closingCap in current
 * DayFacts. `shiftEnd` is separate; never use `window.to` as shift end.
 */
export function closeDecision(
  events: readonly AttendanceEventInput[],
  window: EligibilityWindow | null,
  shiftEnd: Date | null,
  closingCap: Date,
  now: Date,
): CloseDecision {
  const reading = readDay(events, window);
  if (reading.departure !== null) return { kind: 'real-departure' };
  if (now < closingCap) return { kind: 'still-open' };
  if (reading.arrival === null) return { kind: 'no-show' };

  // arrival, but no departure — place the auto-out (§12.3).
  const eligibleEvents = events.filter((e) => {
    if (window === null || e.source === 'correction') return true;
    const t = Date.parse(e.at);
    return t >= Date.parse(window.from) && t <= Date.parse(window.to);
  });

  const arrivalMs = Date.parse(reading.arrival.at);

  // D32 governs both the final event and whether a scan is final evidence.
  const ordered = [...eligibleEvents].sort(compareEvents);
  const lastEvent = ordered.at(-1) ?? null;
  const lastEventMs = lastEvent ? Date.parse(lastEvent.at) : arrivalMs;

  // "Later second than arrival" is a time test. "No event later than scan"
  // uses D32: break-start in the same second follows scan.
  const lastScan = ordered.filter(
    (e) => e.kind === 'scan' && Date.parse(e.at) > arrivalMs,
  ).at(-1);
  if (lastScan !== undefined && !ordered.some((e) => compareEvents(e, lastScan) > 0)) {
    return { kind: 'auto-out', at: new Date(lastScan.at), basis: 'last-scan' };
  }

  const shiftEndMs = shiftEnd?.getTime() ?? -Infinity;
  if (shiftEndMs > lastEventMs) {
    return { kind: 'auto-out', at: new Date(shiftEndMs), basis: 'shift-end' };
  }

  // Last eligible event's time — never earlier than arrival (safety).
  return { kind: 'auto-out', at: new Date(Math.max(lastEventMs, arrivalMs)), basis: 'last-event' };
}
