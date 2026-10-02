import type {
  AttendanceEventInput,
  DateOnly,
  PresenceState,
} from '@tapcrm/contracts';
import { readDay, type EligibilityWindow } from '@tapcrm/contracts';

/**
 * Pure helpers wrapping `presence.ts` (§5.3) into the shape `user_status`
 * stores. No I/O, no clock beyond `now`; the projector calls this then
 * passes the result to `repo.upsertRow`.
 *
 * `rollover_due_at` is the next time the row NEEDS re-evaluation, not the
 * final cap of any session. Three distinct instants matter and are not the
 * same thing on a night shift:
 *
 *   shift_end_at   the scheduled end of the shift on this date
 *   window_end     the person's DAY boundary (§5.2, §6.6 midpoint)
 *   closing_cap    latest a still-open session may collect events (§5.2, §8.5)
 *
 * Rule:
 *   FINISHED or NOT_IN                     → window_end
 *   session open, now < shift_end_at       → min(shift_end_at, window_end)
 *   session open, now >= shift_end_at      → min(closing_cap, next_shift_start)
 *
 * See the plan (Task 2) for the worked example.
 */

export interface DerivedRow {
  readonly workDate: DateOnly;
  readonly state: PresenceState;
  readonly since: Date | null;
  readonly lastEventAt: Date | null;
  readonly workedMinutes: number;
  readonly breakMinutes: number;
  readonly presenceConfidence: 'confirmed' | 'assumed';
  readonly lastScanAt: Date | null;
  readonly lastScanDevice: string | null;
  readonly likelyFinishedAt: Date | null;
  readonly isWfh: boolean;
  readonly dayGroup: 'leave' | 'holiday' | null;
  readonly shiftStartAt: Date | null;
  readonly shiftEndAt: Date | null;
  readonly windowStart: Date;
  readonly windowEnd: Date;
  readonly rolloverDueAt: Date;
  readonly graceMinutes: number | null;
  readonly flexibleTargetMinutes: number | null;
}

export interface DeriveInputs {
  readonly workDate: DateOnly;
  readonly events: readonly AttendanceEventInput[];
  readonly window: {
    readonly start: Date;
    readonly end: Date;
    readonly eligibility: EligibilityWindow;
  };
  readonly shift: {
    readonly startAt: Date | null;
    readonly endAt: Date | null;
    readonly graceMinutes: number | null;
    readonly flexibleTargetMinutes: number | null;
  };
  readonly isWfh: boolean;
  readonly dayGroup: 'leave' | 'holiday' | null;
  /** Next-day inputs for `rollover_due_at` (`min(closing_cap, next_shift_start)`). */
  readonly closingCap: Date | null;
  readonly nextShiftStart: Date | null;
  readonly now: Date;
  /** Metadata about the last-seen scan; the caller can pass a device name. */
  readonly lastScanDevice?: string | null;
}

function minDate(...dates: (Date | null)[]): Date | null {
  let out: Date | null = null;
  for (const d of dates) {
    if (d === null) continue;
    if (out === null || d < out) out = d;
  }
  return out;
}

function computeMinutes(
  arrival: { at: string } | null,
  departure: { at: string } | null,
  breaks: readonly { from: string; to: string | null }[],
  now: Date,
): { workedMinutes: number; breakMinutes: number } {
  if (arrival === null) return { workedMinutes: 0, breakMinutes: 0 };
  const arrivalMs = Date.parse(arrival.at);
  const endMs = departure !== null ? Date.parse(departure.at) : now.getTime();
  let breakMs = 0;
  for (const b of breaks) {
    const from = Date.parse(b.from);
    const to = b.to !== null ? Date.parse(b.to) : Math.min(endMs, now.getTime());
    breakMs += Math.max(0, to - from);
  }
  const totalMs = Math.max(0, endMs - arrivalMs);
  const workedMs = Math.max(0, totalMs - breakMs);
  return {
    workedMinutes: Math.floor(workedMs / 60_000),
    breakMinutes: Math.floor(breakMs / 60_000),
  };
}

function computeSince(
  state: PresenceState,
  reading: ReturnType<typeof readDay>,
): Date | null {
  if (state === 'NOT_IN') return null;
  if (state === 'WORKING') {
    // Since the last transition into WORKING: the last break-end if any, else arrival.
    const closedBreaks = reading.breaks.filter((b) => b.to !== null);
    if (closedBreaks.length > 0) {
      return new Date(closedBreaks[closedBreaks.length - 1]!.to as string);
    }
    return reading.arrival !== null ? new Date(reading.arrival.at) : null;
  }
  if (state === 'ON_BREAK') {
    const openBreak = reading.breaks.find((b) => b.to === null);
    return openBreak !== undefined ? new Date(openBreak.from) : null;
  }
  // FINISHED
  return reading.departure !== null ? new Date(reading.departure.at) : null;
}

function computeRolloverDueAt(
  state: PresenceState,
  now: Date,
  shiftEndAt: Date | null,
  windowEnd: Date,
  closingCap: Date | null,
  nextShiftStart: Date | null,
): Date {
  // FINISHED / NOT_IN → the day rolls at its boundary.
  if (state === 'FINISHED' || state === 'NOT_IN') return windowEnd;
  // Session open, before shift end → first re-eval at min(shift_end_at, window_end).
  if (shiftEndAt !== null && now < shiftEndAt) {
    return shiftEndAt < windowEnd ? shiftEndAt : windowEnd;
  }
  // Session open, past shift end (or flexible / no shift-end) → min(closing_cap, next_shift_start).
  const next = minDate(closingCap, nextShiftStart);
  return next ?? windowEnd;
}

export function deriveRow(inputs: DeriveInputs): DerivedRow {
  const { events, window, shift, now } = inputs;
  const reading = readDay(events, window.eligibility);

  // The last EFFECTIVE event (by at) drives presence_confidence and last_scan.
  const effective = events.filter(
    (e) => !reading.notApplied.has(e.id) || e.source === 'correction',
  );
  effective.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  const lastEvent = effective.length > 0 ? effective[effective.length - 1]! : null;
  const lastScan = [...effective].reverse().find((e) => e.kind === 'scan') ?? null;

  const presenceConfidence: 'confirmed' | 'assumed' =
    lastEvent !== null && lastEvent.evidence === 'assumed' ? 'assumed' : 'confirmed';

  // LS-1: after an undirected assumed scan at/after shift end, WORKING still
  // holds but the row's `likely_finished_at` takes it out of the working count.
  const likelyFinishedAt =
    reading.state === 'WORKING' &&
    lastScan !== null &&
    lastScan.evidence === 'assumed' &&
    shift.endAt !== null &&
    Date.parse(lastScan.at) >= shift.endAt.getTime()
      ? shift.endAt
      : null;

  const { workedMinutes, breakMinutes } = computeMinutes(
    reading.arrival,
    reading.departure,
    reading.breaks,
    now,
  );

  return {
    workDate: inputs.workDate,
    state: reading.state,
    since: computeSince(reading.state, reading),
    lastEventAt: lastEvent !== null ? new Date(lastEvent.at) : null,
    workedMinutes,
    breakMinutes,
    presenceConfidence,
    lastScanAt: lastScan !== null ? new Date(lastScan.at) : null,
    lastScanDevice: inputs.lastScanDevice ?? null,
    likelyFinishedAt,
    isWfh: inputs.isWfh,
    dayGroup: inputs.dayGroup,
    shiftStartAt: shift.startAt,
    shiftEndAt: shift.endAt,
    windowStart: window.start,
    windowEnd: window.end,
    rolloverDueAt: computeRolloverDueAt(
      reading.state,
      now,
      shift.endAt,
      window.end,
      inputs.closingCap,
      inputs.nextShiftStart,
    ),
    graceMinutes: shift.graceMinutes,
    flexibleTargetMinutes: shift.flexibleTargetMinutes,
  };
}
