import type { DateOnly } from '@tapcrm/contracts';
import { addDays, instantAt, localDateOf, toLocalTime } from '../../platform/time.js';
import { anchorShift, resolveShift, settingOn, type ShiftInputs } from './resolve.js';

/**
 * Day windows — design §5.2, SH-3, SH-I1. Geometry only.
 *
 * Between two consecutive days the boundary is the midpoint of the off-duty
 * gap: halfway between one day's shift end and the next day's shift start.
 * Both days compute the same boundary from the same two shifts, so the windows
 * tile time and every instant belongs to exactly one day.
 *
 * A day with no fixed times borrows an anchor instead of falling back to
 * midnight: the person's assigned template, else the department default, else
 * the organization's day-start time. It never looks at a neighbouring day.
 *
 * A window partitions time. It never decides which day an event belongs to —
 * that is attendance's `attributeEvent`, which may cross a boundary (§5.2).
 */

export type AnchorSource =
  'own-shift' | 'rotation' | 'template' | 'department-default' | 'day-start';

export interface DayShape {
  readonly date: DateOnly;
  /** The shift's start, or the anchor's. */
  readonly start: Date;
  /** The shift's end — on the next date when overnight — or the anchor's. */
  readonly end: Date;
  readonly anchor: AnchorSource;
  readonly shiftId: string | null;
}

export interface DayWindow {
  readonly date: DateOnly;
  /** Inclusive. */
  readonly start: Date;
  /** Exclusive. */
  readonly end: Date;
  /**
   * A neighbouring shift overlaps this one. Validation refuses that on the way
   * in; data that still has it is flagged `shift-window-overlap` and the day is
   * left unevaluated (§5.2).
   */
  readonly overlap: boolean;
  readonly shape: DayShape;
}

const DAY_START = toLocalTime('00:00');

export function dayShape(inputs: ShiftInputs, date: DateOnly): DayShape {
  const resolved = resolveShift(inputs, date);
  const fixed = resolved.kind === 'fixed' ? resolved : anchorShift(inputs, date);
  if (fixed !== null && fixed.start !== null && fixed.end !== null) {
    return {
      date,
      start: instantAt(date, fixed.start, inputs.timezone),
      end: instantAt(
        fixed.isOvernight ? addDays(date, 1) : date,
        fixed.end,
        inputs.timezone,
      ),
      anchor: fixed === resolved ? 'own-shift' : (fixed.source as AnchorSource),
      shiftId: fixed.shiftId,
    };
  }
  const at = instantAt(
    date,
    settingOn(inputs, date)?.dayStartTime ?? DAY_START,
    inputs.timezone,
  );
  return { date, start: at, end: at, anchor: 'day-start', shiftId: null };
}

/** Halfway, in whole seconds (T-6). */
function midpoint(a: Date, b: Date): Date {
  return new Date(Math.floor((a.getTime() + b.getTime()) / 2_000) * 1_000);
}

export function windowBetween(
  previous: DayShape,
  day: DayShape,
  next: DayShape,
): DayWindow {
  return {
    date: day.date,
    start: midpoint(previous.end, day.start),
    end: midpoint(day.end, next.start),
    overlap: previous.end > day.start || day.end > next.start,
    shape: day,
  };
}

export function dayWindow(inputs: ShiftInputs, date: DateOnly): DayWindow {
  return windowBetween(
    dayShape(inputs, addDays(date, -1)),
    dayShape(inputs, date),
    dayShape(inputs, addDays(date, 1)),
  );
}

/** The day whose window holds `instant`: its local date, the day before, or the day after. */
export function dayWindowContaining(inputs: ShiftInputs, instant: Date): DayWindow {
  const local = localDateOf(instant, inputs.timezone);
  for (const date of [local, addDays(local, -1), addDays(local, 1)]) {
    const window = dayWindow(inputs, date);
    if (window.start <= instant && instant < window.end) return window;
  }
  // Windows tile time, so this is reached only with overlapping shifts, which
  // are flagged; the local date is then the least surprising answer.
  return dayWindow(inputs, local);
}
