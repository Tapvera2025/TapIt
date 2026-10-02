// packages/server/src/modules/leave/rules.ts
import type { DateOnly, LeaveHalf } from '@tapcrm/contracts';

export function overlayKindForDay(
  date: DateOnly,
  fromDate: DateOnly,
  toDate: DateOnly,
  fromHalf: LeaveHalf,
  toHalf: LeaveHalf,
): 'leave-full' | 'leave-first-half' | 'leave-second-half' {
  const isFirst = date === fromDate;
  const isLast  = date === toDate;
  if (isFirst && isLast) {
    // single-day: fromHalf governs; toHalf is ignored
    if (fromHalf === 'first')  return 'leave-first-half';
    if (fromHalf === 'second') return 'leave-second-half';
    return 'leave-full';
  }
  if (isFirst) {
    // multi-day first: only 'second' qualifies as a half-day
    return fromHalf === 'second' ? 'leave-second-half' : 'leave-full';
  }
  if (isLast) {
    return toHalf === 'first' ? 'leave-first-half' : 'leave-full';
  }
  return 'leave-full';
}

export interface BalanceEntry {
  kind: 'opening' | 'accrual' | 'consumption' | 'reversal' | 'adjustment';
  /** Signed only for an adjustment; every other kind is a positive quantity. */
  units: number;
}

/**
 * Ledger balance by construction (LV-11): opening + accrued − consumed +
 * reversed ± adjusted. The yearly entitlement is added by the caller
 * (`yearlyEntitlement`); it is derived, not stored.
 */
export function balanceAvailable(entries: readonly BalanceEntry[]): number {
  return entries.reduce((sum, e) => {
    const sign = e.kind === 'consumption' ? -1 : 1;
    return sum + sign * e.units;
  }, 0);
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function dayOfYear(date: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const cumulative = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  return cumulative[m - 1]! + d + (m > 2 && isLeapYear(y) ? 1 : 0);
}

/**
 * The year's entitlement for a leave type granting `accrualDays` a year,
 * pro-rated to the days of that year the person is employed (owner decision,
 * 29 Sep 2026): someone joining on 1 July gets about half. Rounded to the
 * nearest half day. A missing joining date is no lower bound.
 */
export function yearlyEntitlement(
  accrualDays: number,
  year: number,
  joinedOn: string | null,
  leftOn: string | null,
): number {
  if (accrualDays <= 0) return 0;
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;
  const from = joinedOn !== null && joinedOn > yearStart ? joinedOn : yearStart;
  const to = leftOn !== null && leftOn < yearEnd ? leftOn : yearEnd;
  if (from > to) return 0;
  const daysInYear = isLeapYear(year) ? 366 : 365;
  const employedDays = dayOfYear(to) - dayOfYear(from) + 1;
  return Math.round(((accrualDays * employedDays) / daysInYear) * 2) / 2;
}

/**
 * Days consumed for a leave request.
 *
 * @param workingDays   working days in [fromDate, toDate] (from CalendarFacade.leaveDays)
 * @param fromHalf      half-day marker on first calendar day
 * @param toHalf        half-day marker on last calendar day
 * @param firstDayIsWorking  whether fromDate is a working day
 * @param lastDayIsWorking   whether toDate is a working day
 * @param isSingleDay   fromDate === toDate
 */
export function daysConsumed(
  workingDays: number,
  fromHalf: LeaveHalf,
  toHalf: LeaveHalf,
  firstDayIsWorking: boolean,
  lastDayIsWorking: boolean,
  isSingleDay: boolean,
): number {
  if (isSingleDay) {
    if (!firstDayIsWorking) return 0;
    return fromHalf === 'full' ? 1 : 0.5;
  }
  let total = workingDays;
  // Multi-day: deduct only when the qualifying flag is set AND the boundary day is working.
  if (fromHalf === 'second' && firstDayIsWorking) total -= 0.5;
  if (toHalf === 'first' && lastDayIsWorking) total -= 0.5;
  return total;
}
