import type {
  AttendanceEventInput,
  AttendanceStatus,
  DateOnly,
  DayStep,
  LocalTime,
  ResolvedShift,
} from '@tapcrm/contracts';
import { compareEvents, readDay } from '@tapcrm/contracts';
import { addDays, instantAt } from '../../platform/time.js';

/**
 * The calculator — design §8.2 and §8.3 (AT-1, AT-3, AT-I1, AT-I5).
 *
 * Pure: no clock, no database, no configuration lookup. Everything a day
 * depends on is in its input, so replaying a day a year later gives the same
 * answer, and `RULES_VERSION` says which code produced it. It reads the day
 * through `readDay` (§5.3), the same reading attribution, auto-close and the
 * board use, so they cannot disagree about when a day began or ended.
 */

export const RULES_VERSION = 'attendance-rules/1';

/** SH-4: flexible days use fixed thresholds, not settings. */
const FLEXIBLE_FULL_DAY = 480;
const FLEXIBLE_HALF_DAY = 300;

export interface Overlay {
  readonly kind:
    | 'leave-full'
    | 'leave-first-half'
    | 'leave-second-half'
    | 'wfh'
    | 'breach-consequence';
  readonly paid: boolean | null;
  readonly consequence:
    'mark-late' | 'mark-half-day' | 'mark-absent' | 'deduct-minutes' | null;
  readonly minutes: number | null;
  /** The leave request or breach behind it (L8). */
  readonly sourceId: string;
}

export interface CalculationInput {
  readonly workDate: DateOnly;
  readonly shift: ResolvedShift;
  /** The record's close_due_at — the late edge of the eligibility window (§8.2 step 3). */
  readonly closingCap: Date;
  /** The record is closed: a day with no departure is then final, not in progress. */
  readonly closed: boolean;
  readonly dayType: 'working' | 'week-off' | 'holiday' | 'not-employed';
  /** Inside the employment window. Always true until employment dates exist. */
  readonly employed: boolean;
  /** The day's effective events (D28), as assigned to it. */
  readonly events: readonly AttendanceEventInput[];
  readonly overlays: readonly Overlay[];
  /** D19: with no break policy, break time is paid. */
  readonly breaksPaid: boolean;
  /** The organization's night window in force on the date (§6.6), or null. */
  readonly nightWindow: { readonly from: LocalTime; readonly to: LocalTime } | null;
  /** Flags attribution raised about this day (§5.2). */
  readonly attributionFlags: readonly string[];
}

/** Half-day units (D7): each day's add up to 2, or 0 when it is not judged. */
export interface Units {
  readonly present: number;
  readonly paidLeave: number; // a half-day count, not money (CI-21)
  readonly unpaidLeave: number;
  readonly absent: number;
  readonly holiday: number;
}

export interface CalculatedAttendance {
  readonly status: AttendanceStatus | null;
  readonly units: Units;
  readonly workedMinutes: number;
  readonly breakMinutes: number;
  readonly lateMinutes: number;
  readonly earlyExitMinutes: number;
  readonly overtimeMinutes: number;
  readonly nightMinutes: number;
  readonly arrivalAt: string | null;
  readonly departureAt: string | null;
  readonly isWfh: boolean;
  readonly flags: readonly string[];
  readonly provenance: Readonly<Record<string, unknown>>;
}

type Interval = readonly [number, number];

const NO_UNITS: Units = {
  present: 0,
  paidLeave: 0,
  unpaidLeave: 0,
  absent: 0,
  holiday: 0,
};
const toMinutes = (ms: number) => Math.floor(ms / 60_000);
const length = (intervals: readonly Interval[]) =>
  intervals.reduce((sum, [a, b]) => sum + Math.max(0, b - a), 0);

function intersect(a: readonly Interval[], b: readonly Interval[]): Interval[] {
  const out: Interval[] = [];
  for (const [a0, a1] of a) {
    for (const [b0, b1] of b) {
      const from = Math.max(a0, b0);
      const to = Math.min(a1, b1);
      if (to > from) out.push([from, to]);
    }
  }
  return out;
}

function subtract(base: Interval, cuts: readonly Interval[]): Interval[] {
  let pieces: Interval[] = [base];
  for (const [c0, c1] of cuts) {
    pieces = pieces.flatMap(([p0, p1]): Interval[] => {
      if (c1 <= p0 || c0 >= p1) return [[p0, p1]];
      return [
        ...(c0 > p0 ? [[p0, c0] as Interval] : []),
        ...(c1 < p1 ? [[c1, p1] as Interval] : []),
      ];
    });
  }
  return pieces;
}

/** The night window on every date the day's work can span (§6.6). */
function nightIntervals(input: CalculationInput): Interval[] {
  const window = input.nightWindow;
  if (window === null) return [];
  const zone = input.shift.timezone;
  const out: Interval[] = [];
  for (const offset of [-1, 0, 1]) {
    const date = addDays(input.workDate, offset);
    const from = instantAt(date, window.from, zone).getTime();
    const to = instantAt(
      window.to <= window.from ? addDays(date, 1) : date,
      window.to,
      zone,
    ).getTime();
    out.push([from, to]);
  }
  return out;
}

const NOT_APPLIED_FLAGS: Readonly<Record<string, string>> = {
  'outside-window': 'outside-shift-window',
  'after-departure': 'activity-after-finish',
  'at-arrival-instant': 'same-instant-conflict',
};

export function calculate(input: CalculationInput): CalculatedAttendance {
  const flags = new Set<string>(input.attributionFlags);
  const events = [...input.events].sort(compareEvents);
  const provenance: Record<string, unknown> = {
    rulesVersion: RULES_VERSION,
    shiftSource: input.shift.source,
    shiftId: input.shift.shiftId,
    versionId: input.shift.versionId,
    eventIds: events.map((event) => event.id),
    overlayIds: input.overlays.map((overlay) => overlay.sourceId),
  };
  const finish = (
    result: Omit<CalculatedAttendance, 'flags' | 'provenance'>,
  ): CalculatedAttendance => ({
    ...result,
    flags: [...flags].sort(),
    provenance,
  });
  const empty = {
    workedMinutes: 0,
    breakMinutes: 0,
    lateMinutes: 0,
    earlyExitMinutes: 0,
    overtimeMinutes: 0,
    nightMinutes: 0,
    arrivalAt: null,
    departureAt: null,
    isWfh: false,
  };

  // 1. Employment.
  if (!input.employed || input.dayType === 'not-employed') {
    return finish({ ...empty, status: 'not-employed', units: NO_UNITS });
  }

  // 2–3. Effective events, and the eligibility window: [start − early window, closingCap].
  const fixed =
    input.shift.kind === 'fixed' &&
    input.shift.start !== null &&
    input.shift.end !== null;
  const zone = input.shift.timezone;
  const shiftStart = fixed
    ? instantAt(input.workDate, input.shift.start!, zone).getTime()
    : null;
  const shiftEnd = fixed
    ? instantAt(
        input.shift.isOvernight ? addDays(input.workDate, 1) : input.workDate,
        input.shift.end!,
        zone,
      ).getTime()
    : null;
  const eligibility =
    shiftStart === null
      ? null
      : {
          from: new Date(
            shiftStart - input.shift.earlyWindowMinutes * 60_000,
          ).toISOString(),
          to: input.closingCap.toISOString(),
        };
  provenance['eligibility'] = eligibility;

  // 4–5. One reading of the day: arrival, departure, breaks (D31, D32).
  const reading = readDay(events, eligibility);
  for (const [eventId, why] of reading.notApplied) {
    const kind = events.find((event) => event.id === eventId)?.kind;
    if (why === 'before-arrival' && (kind === 'out' || kind === 'auto-out'))
      flags.add('departure-without-arrival');
    const flag = NOT_APPLIED_FLAGS[why];
    if (flag !== undefined) flags.add(flag);
  }
  const arrival: DayStep | null = reading.arrival;
  const departure: DayStep | null = reading.departure;

  // 6. Minutes: the worked stretches, less unpaid breaks.
  let stretches: Interval[] = [];
  let breakMinutes = 0;
  if (arrival !== null && departure !== null) {
    const end = Date.parse(departure.at);
    const breaks: Interval[] = reading.breaks.map((b) => [
      Date.parse(b.from),
      b.to === null ? end : Date.parse(b.to),
    ]);
    breakMinutes = toMinutes(length(breaks));
    const base: Interval = [Date.parse(arrival.at), end];
    stretches = input.breaksPaid ? [base] : subtract(base, breaks);
    // An undirected scan while on break ends it, as an assumption (§8.2 step 5).
    const scans = new Set(
      events.filter((e) => e.kind === 'scan').map((e) => Date.parse(e.at)),
    );
    if (reading.breaks.some((b) => b.to !== null && scans.has(Date.parse(b.to))))
      flags.add('break-ended-by-scan');
  } else if (arrival !== null && input.closed) {
    flags.add('missing-punch-out');
  }
  const workedMinutes = toMinutes(length(stretches));
  const nightMinutes = toMinutes(length(intersect(stretches, nightIntervals(input))));

  // WFH is a flag, never a status (AT-12b); a device scan clears it (WFH-9).
  const wfh = input.overlays.some((overlay) => overlay.kind === 'wfh');
  const isWfh = wfh && !events.some((event) => event.source === 'device');
  if (isWfh) flags.add('wfh');
  if (
    !wfh &&
    arrival !== null &&
    events.some(
      (e) =>
        arrival.eventIds.includes(e.id) && (e.source === 'web' || e.source === 'mobile'),
    )
  ) {
    flags.add('remote-without-approval'); // WFH-6
  }

  // 7. Shift facts, fixed shifts on working days only.
  let lateMinutes = 0;
  let earlyExitMinutes = 0;
  let overtimeMinutes = 0;
  if (
    shiftStart !== null &&
    shiftEnd !== null &&
    arrival !== null &&
    departure !== null &&
    input.dayType === 'working'
  ) {
    lateMinutes = Math.max(
      0,
      toMinutes(
        Date.parse(arrival.at) - (shiftStart + input.shift.graceMinutes * 60_000),
      ),
    );
    earlyExitMinutes = Math.max(
      0,
      toMinutes(
        shiftEnd - input.shift.earlyExitGraceMinutes * 60_000 - Date.parse(departure.at),
      ),
    );
    const extra = workedMinutes - toMinutes(shiftEnd - shiftStart);
    const minimum = input.shift.minOvertimeMinutes;
    if (minimum !== null && extra > 0 && extra >= minimum) overtimeMinutes = extra;
    if (lateMinutes > 0) flags.add('late');
    if (earlyExitMinutes > 0) flags.add('early-exit');
    if (overtimeMinutes > 0) {
      flags.add('overtime');
      // Recorded but not credited while it rests on an assumed departure (§8.2 step 7).
      if (departure.evidence === 'assumed') flags.add('overtime-unconfirmed');
    }
  }

  const minutes = {
    workedMinutes,
    breakMinutes,
    lateMinutes,
    earlyExitMinutes,
    overtimeMinutes,
    nightMinutes,
    arrivalAt: arrival?.at ?? null,
    departureAt: departure?.at ?? null,
    isWfh,
  };
  const leave = (paid: boolean | null, units: number) =>
    paid === false
      ? { paidLeave: 0, unpaidLeave: units }
      : { paidLeave: units, unpaidLeave: 0 };
  const consequences = input.overlays.filter(
    (overlay) => overlay.kind === 'breach-consequence',
  );

  // 8. Status and units, by the fixed precedence of AT-3.
  // 1. Holiday or week-off.
  if (input.dayType === 'holiday' || input.dayType === 'week-off') {
    if (arrival !== null) flags.add('holiday-worked');
    if (consequences.length > 0) provenance['consequences'] = 'superseded by holiday';
    return finish({ ...minutes, status: 'holiday', units: { ...NO_UNITS, holiday: 2 } });
  }
  // 2. Approved full-day leave.
  const fullLeave = input.overlays.find((overlay) => overlay.kind === 'leave-full');
  if (fullLeave !== undefined) {
    if (arrival !== null) flags.add('punched-on-leave');
    if (consequences.length > 0) provenance['consequences'] = 'superseded by leave'; // BM-14
    return finish({
      ...minutes,
      status: 'leave',
      units: { ...NO_UNITS, ...leave(fullLeave.paid, 2) },
    });
  }
  // Nothing more to judge without fixed times: a no-shift day records hours only.
  if (input.shift.kind === 'none' || flags.has('shift-window-overlap')) {
    return finish({ ...minutes, status: 'not-evaluated', units: NO_UNITS });
  }
  // 3. Approved half-day leave: the other half is judged on its own (§8.3).
  const halfLeave = input.overlays.find(
    (o) => o.kind === 'leave-first-half' || o.kind === 'leave-second-half',
  );
  if (halfLeave !== undefined) {
    if (consequences.length > 0) provenance['consequences'] = 'superseded by leave';
    if (!input.closed && departure === null)
      return finish({ ...minutes, status: null, units: NO_UNITS });
    let workedForPresence = workedMinutes;
    let threshold = Math.floor(FLEXIBLE_HALF_DAY / 2);
    if (shiftStart !== null && shiftEnd !== null) {
      const split = shiftStart + (shiftEnd - shiftStart) / 2;
      const complement: Interval =
        halfLeave.kind === 'leave-first-half' ? [split, shiftEnd] : [shiftStart, split];
      workedForPresence = toMinutes(length(intersect(stretches, [complement])));
      threshold =
        input.shift.complementaryHalfMinutes ??
        Math.floor((input.shift.halfDayMinutes ?? 0) / 2);
    }
    const present = workedForPresence >= threshold ? 1 : 0;
    return finish({
      ...minutes,
      status: 'half-day-leave',
      units: { ...NO_UNITS, ...leave(halfLeave.paid, 1), present, absent: 1 - present },
    });
  }
  // A working day still in progress is not judged until it has a departure or is closed.
  if (!input.closed && departure === null)
    return finish({ ...minutes, status: null, units: NO_UNITS });

  // 4–6. Worked time against the day's thresholds, less confirmed deductions.
  const deducted = consequences
    .filter((overlay) => overlay.consequence === 'deduct-minutes')
    .reduce((sum, overlay) => sum + (overlay.minutes ?? 0), 0);
  const effective = Math.max(0, workedMinutes - deducted);
  const fullDay =
    input.shift.kind === 'flexible'
      ? FLEXIBLE_FULL_DAY
      : (input.shift.fullDayMinutes ?? Infinity);
  const halfDay =
    input.shift.kind === 'flexible'
      ? FLEXIBLE_HALF_DAY
      : (input.shift.halfDayMinutes ?? Infinity);
  let present = effective >= fullDay ? 2 : effective >= halfDay ? 1 : 0;
  if (consequences.some((overlay) => overlay.consequence === 'mark-half-day'))
    present = Math.min(present, 1);
  if (consequences.some((overlay) => overlay.consequence === 'mark-absent')) present = 0;
  if (consequences.some((overlay) => overlay.consequence === 'mark-late'))
    flags.add('late');
  const status: AttendanceStatus =
    present === 2 ? 'present' : present === 1 ? 'half-day' : 'absent';
  return finish({
    ...minutes,
    workedMinutes: effective,
    status,
    units: { ...NO_UNITS, present, absent: 2 - present },
  });
}
