/**
 * The shifts façade — the only file other modules may import (MB-1, design §4).
 *
 * Synchronous, and every function takes the caller's transaction (MB-2, TX-5).
 * Callers: attendance, live-status, break-management, holidays, payroll.
 * Geometry only: which shift applied and where a day's window lies. Which day
 * an event belongs to is attendance's `attributeEvent` (§5.2).
 */
import type { DateOnly, PlacementsByDate, ResolvedShift } from '@tapcrm/contracts';
import type { Tx } from '../../platform/dal/db.js';
import { addDays, localDateOf } from '../../platform/time.js';
import { findShift, loadShiftInputs } from './repository.js';
import { resolveShift } from './resolve.js';
import {
  dayWindow as windowOf,
  dayWindowContaining as windowContaining,
  type DayWindow,
} from './windows.js';

export type { DayWindow } from './windows.js';
export { SHIFT_EVENTS, type DaysChanged } from './events.js';

/**
 * Whether a shift template exists in this tenant, regardless of its status.
 * Used by holidays to validate `holiday_scope.shift_id` targets without
 * reading the `shift` table directly (SH-1).
 */
export async function exists(tx: Tx, shiftId: string): Promise<boolean> {
  return (await findShift(tx, shiftId)) !== null;
}

/** SH-1 — the shift that applied to the person on the date, and why. */
export async function resolve(
  tx: Tx,
  userId: string,
  date: DateOnly,
): Promise<ResolvedShift> {
  return resolveShift(await loadShiftInputs(tx, userId, date, date), date);
}

export interface RangeOptions {
  /**
   * The department each already-built day recorded (attendance design §8.1).
   * Those dates resolve with it instead of today's department, so a past day
   * keeps its department after a transfer.
   */
  readonly placements?: PlacementsByDate;
}

/** SH-1 for every date from `from` to `to`, inclusive, with one read. */
export async function resolveRange(
  tx: Tx,
  userId: string,
  from: DateOnly,
  to: DateOnly,
  options: RangeOptions = {},
): Promise<ResolvedShift[]> {
  const inputs = await loadShiftInputs(tx, userId, from, to, options.placements);
  const days: ResolvedShift[] = [];
  for (let date = from; date <= to; date = addDays(date, 1))
    days.push(resolveShift(inputs, date));
  return days;
}

/** SH-I1 — the day's window: from the midpoint before it to the midpoint after it. */
export async function dayWindow(
  tx: Tx,
  userId: string,
  date: DateOnly,
): Promise<DayWindow> {
  return windowOf(await loadShiftInputs(tx, userId, date, date), date);
}

/** The day whose window holds the instant. */
export async function dayWindowContaining(
  tx: Tx,
  userId: string,
  instant: Date,
): Promise<DayWindow> {
  const inputs = await loadShiftInputs(
    tx,
    userId,
    addDays(localDateOfUtc(instant), -1),
    addDays(localDateOfUtc(instant), 1),
  );
  return windowContaining(inputs, instant);
}

/** The inputs load a margin of days either side, so the UTC date is close enough to pick the range. */
function localDateOfUtc(instant: Date): DateOnly {
  return localDateOf(instant, 'UTC');
}

/** One date's shift and window, for callers that need both. */
export interface ShiftDay {
  readonly shift: ResolvedShift;
  readonly window: DayWindow;
}

/**
 * The shift and the window of every date from `from` to `to`, inclusive, with
 * one read. Attendance derives its day facts — opening and closing edges — from
 * these (design §5.2, §8.5 `refreshDayFacts`).
 */
export async function shiftDays(
  tx: Tx,
  userId: string,
  from: DateOnly,
  to: DateOnly,
  options: RangeOptions = {},
): Promise<ShiftDay[]> {
  const inputs = await loadShiftInputs(tx, userId, from, to, options.placements);
  const days: ShiftDay[] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) {
    days.push({ shift: resolveShift(inputs, date), window: windowOf(inputs, date) });
  }
  return days;
}
