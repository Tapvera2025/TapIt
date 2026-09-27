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
  kind: 'opening' | 'accrual' | 'consumption' | 'reversal';
  units: number;
}

/** Closing balance by construction (LV-11): opening + accrued − consumed + reversed. */
export function balanceAvailable(entries: readonly BalanceEntry[]): number {
  return entries.reduce((sum, e) => {
    const sign = e.kind === 'consumption' ? -1 : 1;
    return sum + sign * e.units;
  }, 0);
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
