import type { DateOnly } from '@tapcrm/contracts';
import { addDays } from '../../platform/time.js';

/**
 * An employee's employment window: the first and last day they work here,
 * both inclusive. A missing joining date is no lower bound; a missing leaving
 * date leaves the question to the account status (attendance decides that).
 */
export interface EmploymentWindow {
  readonly joinedOn: DateOnly | null;
  readonly leftOn: DateOnly | null;
}

/** Earlier than any day an organization can have (no attendance before it). */
const EARLIEST = '1900-01-01' as DateOnly;

const minOf = (a: DateOnly, b: DateOnly) => (a < b ? a : b);
const maxOf = (a: DateOnly, b: DateOnly) => (a > b ? a : b);

/**
 * The days whose answer to "employed?" may differ between two windows, as
 * one inclusive range; `to` null runs on without end. Null when the windows
 * are the same. Moving the joining date changes the days between the two
 * dates; moving the leaving date, the days after the earlier of the two.
 */
export function changedDays(
  before: EmploymentWindow,
  after: EmploymentWindow,
): { from: DateOnly; to: DateOnly | null } | null {
  const ranges: { from: DateOnly; to: DateOnly | null }[] = [];
  if (before.joinedOn !== after.joinedOn) {
    const a = before.joinedOn ?? EARLIEST;
    const b = after.joinedOn ?? EARLIEST;
    ranges.push({ from: minOf(a, b), to: addDays(maxOf(a, b), -1) });
  }
  if (before.leftOn !== after.leftOn) {
    const earlier =
      before.leftOn === null
        ? after.leftOn!
        : after.leftOn === null
          ? before.leftOn
          : minOf(before.leftOn, after.leftOn);
    const later =
      before.leftOn === null || after.leftOn === null
        ? null
        : maxOf(before.leftOn, after.leftOn);
    ranges.push({ from: addDays(earlier, 1), to: later });
  }
  if (ranges.length === 0) return null;
  return {
    from: ranges.map((range) => range.from).reduce(minOf),
    to: ranges.some((range) => range.to === null)
      ? null
      : ranges.map((range) => range.to!).reduce(maxOf),
  };
}
