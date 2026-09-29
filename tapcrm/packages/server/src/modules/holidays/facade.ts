/**
 * The holidays façade — the only file other modules may import (MB-1, §4).
 *
 * Synchronous entry points, each taking the caller's transaction (MB-2, TX-5).
 * Callers: attendance, leave, payroll. `dayType` is the calendar's answer
 * for one person on one date; `dayTypeRange` returns a batch reading the
 * data once; `leaveDays` (LV-3) counts the days that consume a leave
 * balance in a range.
 */
import type { DateOnly, PlacementsByDate, ResolvedDay } from '@tapcrm/contracts';
import type { Tx } from '../../platform/dal/db.js';
import { addDays } from '../../platform/time.js';
import { loadCalendarInputs } from './repository.js';
import { resolveDay } from './resolve.js';

export { HOLIDAY_EVENTS, type DaysChanged } from './events.js';

/** HO-1, HO-2 — the day's calendar answer for the person on the date. */
export async function dayType(
  tx: Tx,
  userId: string,
  date: DateOnly,
): Promise<ResolvedDay> {
  return resolveDay(await loadCalendarInputs(tx, userId, date, date), date);
}

/**
 * `from..to` inclusive; one read. `placements` are the departments recorded by
 * days attendance has already built (attendance design §8.1): those dates are
 * judged with that department, not today's, so a past day keeps its
 * department's holidays after a transfer.
 */
export async function dayTypeRange(
  tx: Tx,
  userId: string,
  from: DateOnly,
  to: DateOnly,
  options: { readonly placements?: PlacementsByDate } = {},
): Promise<ResolvedDay[]> {
  const inputs = await loadCalendarInputs(tx, userId, from, to, options.placements);
  const out: ResolvedDay[] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) {
    const placement = options.placements?.get(date);
    const onDate =
      placement === undefined
        ? inputs
        : { ...inputs, departmentId: placement.departmentId };
    out.push(resolveDay(onDate, date));
  }
  return out;
}

/** LV-3 — days in `from..to` that consume a leave balance for this person. */
export async function leaveDays(
  tx: Tx,
  userId: string,
  from: DateOnly,
  to: DateOnly,
): Promise<number> {
  const days = await dayTypeRange(tx, userId, from, to);
  return days.filter((d) => d.type === 'working').length;
}
