import type {
  DateOnly,
  HolidaySubtype,
  ResolvedDay,
} from '@tapcrm/contracts';
import { weekdayOf } from '../../platform/time.js';

/**
 * HO-1, HO-2 — one person on one date, as a calendar sees them.
 *
 *   1 an active dated holiday on that date whose scope matches
 *   2 an active week-off rule in force whose recurrence hits the weekday
 *   3 a working day
 *
 * "In force on `date`" means the rule with the latest `effectiveFrom` on or
 * before it whose `effectiveTo` (exclusive) is later. Nobody outside this
 * module decides a person's day type.
 */

export interface HolidayInput {
  readonly id: string;
  readonly name: string;
  readonly type: HolidaySubtype;
  readonly holidayDate: DateOnly | null;
  readonly recurrence: WeekOffRecurrence | null;
  readonly effectiveFrom: DateOnly | null;
  readonly effectiveTo: DateOnly | null; // exclusive
  readonly status: 'active' | 'withdrawn';
  /** For deterministic tie-breaks between two rows that both match. */
  readonly createdAt: string; // ISO instant
}

export interface WeekOffRecurrence {
  /** ISO weekdays: 1 Monday … 7 Sunday. */
  weekdays: number[];
  /** 1..5 (5 = the last week that has this weekday); null means every week. */
  weeksOfMonth?: number[] | undefined;
}

export interface ScopeInput {
  readonly holidayId: string;
  readonly departmentId: string | null;
  readonly shiftId: string | null;
}

/** Everything the resolver reads for one person. */
export interface CalendarInputs {
  readonly timezone: string;
  readonly departmentId: string | null;
  readonly holidays: readonly HolidayInput[];
  readonly scopes: readonly ScopeInput[];
  /**
   * The person's resolved shift id per date, preloaded by the repository via
   * one `ShiftsFacade.resolveRange` call — never per date. `resolveDay` stays
   * pure and synchronous; the async work has already happened by the time it
   * runs. A missing key, or one whose value is null, means "no fixed shift on
   * that date," which is fine for the resolver (nothing in `holiday_scope`
   * will match against `null`).
   */
  readonly shiftIdsByDate: ReadonlyMap<DateOnly, string | null>;
}

const covers = (row: HolidayInput, date: DateOnly): boolean =>
  row.effectiveFrom !== null &&
  row.effectiveFrom <= date &&
  (row.effectiveTo === null || date < row.effectiveTo);

/** 1..5, where 5 means "the last week that has this weekday" (design §7). */
function weekOfMonthOf(date: DateOnly): number {
  const day = Number(date.slice(8, 10));
  return Math.ceil(day / 7);
}

function isLastWeekWithWeekday(date: DateOnly, weekday: number): boolean {
  // The last week is any date within seven days of the month's end.
  const [year, month, day] = date.split('-').map(Number);
  const daysInMonth = new Date(Date.UTC(year!, month, 0)).getUTCDate();
  return day! + 7 > daysInMonth && weekdayOf(date) === weekday;
}

function recurrenceHits(recurrence: WeekOffRecurrence, date: DateOnly): boolean {
  const weekday = weekdayOf(date);
  if (!recurrence.weekdays.includes(weekday)) return false;
  if (recurrence.weeksOfMonth === undefined || recurrence.weeksOfMonth.length === 0)
    return true;
  const week = weekOfMonthOf(date);
  return recurrence.weeksOfMonth.some(
    (n) => n === week || (n === 5 && isLastWeekWithWeekday(date, weekday)),
  );
}

/** Which scope, if any, links this holiday to this person on this date. */
type MatchKind = 'shift' | 'department' | 'national' | null;

function matchScope(
  scopes: readonly ScopeInput[],
  holidayId: string,
  departmentId: string | null,
  shiftIdToday: string | null,
): MatchKind {
  const rows = scopes.filter((s) => s.holidayId === holidayId);
  if (rows.length === 0) return 'national';
  // Shift beats department (design decision: the more specific target wins).
  let best: MatchKind = null;
  for (const s of rows) {
    if (s.shiftId !== null && s.shiftId === shiftIdToday) return 'shift';
    if (s.departmentId !== null && s.departmentId === departmentId) best = 'department';
  }
  return best;
}

const PRIORITY: Record<Exclude<MatchKind, null>, number> = {
  shift: 3,
  department: 2,
  national: 1,
};

/** Stable order among matches at the same priority: earliest createdAt, then id. */
function tieBreak(a: HolidayInput, b: HolidayInput): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return a.id < b.id ? -1 : 1;
}

const working = (date: DateOnly): ResolvedDay => ({
  date,
  type: 'working',
  holidayId: null,
  holidayName: null,
  subtype: null,
  matchedBy: null,
});

export function resolveDay(inputs: CalendarInputs, date: DateOnly): ResolvedDay {
  const shiftIdToday = inputs.shiftIdsByDate.get(date) ?? null;

  // 1. Dated holidays on the date whose scope matches. Optional holidays are
  //    invisible to the calendar until the person claims them (step 6). Among
  //    matches: shift > department > national, then createdAt, then id.
  let bestDated: { holiday: HolidayInput; kind: Exclude<MatchKind, null> } | null = null;
  for (const h of inputs.holidays) {
    if (
      h.status !== 'active' ||
      h.type === 'week-off' ||
      h.type === 'optional' ||
      h.holidayDate !== date
    )
      continue;
    const kind = matchScope(inputs.scopes, h.id, inputs.departmentId, shiftIdToday);
    if (kind === null) continue;
    if (
      bestDated === null ||
      PRIORITY[kind] > PRIORITY[bestDated.kind] ||
      (PRIORITY[kind] === PRIORITY[bestDated.kind] && tieBreak(h, bestDated.holiday) < 0)
    ) {
      bestDated = { holiday: h, kind };
    }
  }
  if (bestDated !== null) {
    return {
      date,
      type: 'holiday',
      holidayId: bestDated.holiday.id,
      holidayName: bestDated.holiday.name,
      subtype: bestDated.holiday.type,
      matchedBy: bestDated.kind,
    };
  }

  // 2. Week-off rules. Scope is checked the same way as dated holidays (a
  //    per-department or per-shift week-off is legitimate). Among applicable
  //    rules, the latest effectiveFrom wins (ties by createdAt, then id).
  //    The scope kind that matched is carried through to `matchedBy`, so a
  //    caller can tell a floor-Saturday from a global Sunday.
  let bestRule:
    | { holiday: HolidayInput; kind: Exclude<MatchKind, null> }
    | null = null;
  for (const h of inputs.holidays) {
    if (h.status !== 'active' || h.type !== 'week-off' || !covers(h, date)) continue;
    const kind = matchScope(inputs.scopes, h.id, inputs.departmentId, shiftIdToday);
    if (kind === null) continue;
    if (
      bestRule === null ||
      (h.effectiveFrom ?? '') > (bestRule.holiday.effectiveFrom ?? '') ||
      ((h.effectiveFrom ?? '') === (bestRule.holiday.effectiveFrom ?? '') &&
        tieBreak(h, bestRule.holiday) < 0)
    ) {
      bestRule = { holiday: h, kind };
    }
  }
  if (bestRule !== null && recurrenceHits(bestRule.holiday.recurrence!, date)) {
    return {
      date,
      type: 'week-off',
      holidayId: bestRule.holiday.id,
      holidayName: bestRule.holiday.name,
      subtype: 'week-off',
      matchedBy: bestRule.kind,
    };
  }

  // 3. A working day.
  return working(date);
}
