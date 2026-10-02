import type {
  AttendanceEventInput,
  DateOnly,
  EventKind,
  LocalTime,
  ResolvedShift,
} from '@tapcrm/contracts';
import { addDays, instantAt } from '../../platform/time.js';
import { factsFor, type DayFacts, type ShiftDayInput } from './day-facts.js';

/**
 * Builders for the pure attendance tests. A roster maps each date to a fixed
 * shift ['20:00', '05:00'] or null (no fixed times, anchored at 00:00), in
 * Asia/Kolkata. Windows are midpoints of the gaps, as shifts computes them.
 */

export const ZONE = 'Asia/Kolkata';
export const d = (value: string) => value as DateOnly;

/** An instant written as IST wall-clock time. */
export const ist = (local: string) => new Date(`${local}+05:30`);

type Roster = Record<string, readonly [string, string] | null>;

function shift(date: DateOnly, times: readonly [string, string] | null): ResolvedShift {
  const [start, end] = times ?? [null, null];
  return {
    date,
    source: times === null ? 'none' : 'template',
    shiftId: times === null ? null : `shift-${start}`,
    versionId: null,
    kind: times === null ? 'none' : 'fixed',
    start: start as LocalTime | null,
    end: end as LocalTime | null,
    isOvernight: start !== null && end !== null && end < start,
    graceMinutes: 10,
    earlyExitGraceMinutes: 0,
    fullDayMinutes: times === null ? null : 450,
    halfDayMinutes: times === null ? null : 240,
    complementaryHalfMinutes: null,
    minOvertimeMinutes: 30,
    earlyWindowMinutes: times === null ? 0 : 180,
    maxClosingExtensionMinutes: 240,
    timezone: ZONE,
  };
}

/** Facts for every date of the roster except its first and last. */
export function rosterFacts(roster: Roster): Map<DateOnly, DayFacts> {
  const dates = Object.keys(roster).sort() as DateOnly[];
  const shapes = dates.map((date) => {
    const times = roster[date] ?? null;
    if (times === null) {
      const midnight = instantAt(date, '00:00' as LocalTime, ZONE);
      return { date, start: midnight, end: midnight, times };
    }
    const [start, end] = times;
    return {
      date,
      start: instantAt(date, start as LocalTime, ZONE),
      end: instantAt(end < start ? addDays(date, 1) : date, end as LocalTime, ZONE),
      times,
    };
  });
  const mid = (a: Date, b: Date) =>
    new Date(Math.floor((a.getTime() + b.getTime()) / 2_000) * 1_000);
  const days: ShiftDayInput[] = shapes.map((shape, i) => {
    const previous = shapes[i - 1];
    const next = shapes[i + 1];
    return {
      shift: shift(shape.date, shape.times),
      window: {
        date: shape.date,
        start:
          previous === undefined
            ? new Date(shape.start.getTime() - 43_200_000)
            : mid(previous.end, shape.start),
        end:
          next === undefined
            ? new Date(shape.end.getTime() + 43_200_000)
            : mid(shape.end, next.start),
        overlap: false,
        shape: {
          start: shape.start,
          end: shape.end,
          anchor: shape.times === null ? 'day-start' : 'own-shift',
        },
      },
    };
  });
  return factsFor(days);
}

let counter = 0;
export function punch(
  kind: EventKind,
  local: string,
  extra: Partial<AttendanceEventInput> = {},
): AttendanceEventInput {
  counter += 1;
  return {
    id: extra.id ?? `ev-${String(counter).padStart(4, '0')}`,
    kind,
    at: ist(local).toISOString(),
    source: extra.source ?? (kind === 'scan' || kind === 'auto-out' ? 'device' : 'web'),
    evidence:
      extra.evidence ??
      (kind === 'scan' || kind === 'auto-out' ? 'assumed' : 'confirmed'),
    assignmentReason: extra.assignmentReason ?? 'midpoint',
  };
}
