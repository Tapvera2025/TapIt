import type { DateOnly, EligibilityWindow, ResolvedShift } from '@tapcrm/contracts';

/**
 * A day's facts — design §5.2, §8.5 `refreshDayFacts`.
 *
 * Four numbers steer attribution and auto-close, so they are computed in one
 * place from the day's shift and its neighbours, and stored on the record:
 *
 *   window      the geometric partition from shifts (midpoint to midpoint)
 *   openFrom    = max(start − early window, previous day's end)
 *   closingCap  = min(end + max closing extension, next day's start)
 *   eligibility = [start − early window, closingCap], null without fixed times
 *
 * A neighbour's "start" and "end" are its own shift's, or the anchor its window
 * borrows (§5.2), so a flexible neighbour still bounds a fixed day.
 */

/** The window and shape of one date, as ShiftsFacade.shiftDays returns them. */
export interface ShiftDayInput {
  readonly shift: ResolvedShift;
  readonly window: {
    readonly date: DateOnly;
    readonly start: Date;
    readonly end: Date;
    readonly overlap: boolean;
    readonly shape: { readonly start: Date; readonly end: Date; readonly anchor: string };
  };
}

export interface DayFacts {
  readonly date: DateOnly;
  readonly shift: ResolvedShift;
  readonly windowStart: Date;
  readonly windowEnd: Date;
  /** Arrivals at or after this may start the day (§5.2 rules 1 and 2). */
  readonly openFrom: Date;
  /** The latest instant a session of this day may still collect events; auto-close is due then. */
  readonly closingCap: Date;
  readonly eligibility: EligibilityWindow;
  /** The actual fixed shift end, separate from closingCap (§12.3). Null for flexible/no-shift days. */
  readonly shiftEnd: Date | null;
  /** A neighbouring shift overlaps this one: the day is flagged and not evaluated. */
  readonly overlap: boolean;
}

const minutes = (n: number) => n * 60_000;
const later = (a: Date, b: Date) => (a > b ? a : b);
const earlier = (a: Date, b: Date) => (a < b ? a : b);

/**
 * Facts for `day`, from it and its two neighbours.
 *
 * Without fixed times the design gives no shift edges to extend from, so a
 * flexible or no-shift day opens and closes at its window: nothing pulls an
 * arrival forward into it, and its session reaches no further than its
 * window (plan decision; raised with the owners).
 */
export function dayFacts(
  previous: ShiftDayInput,
  day: ShiftDayInput,
  next: ShiftDayInput,
): DayFacts {
  const { shift, window } = day;
  const base = {
    date: window.date,
    shift,
    windowStart: window.start,
    windowEnd: window.end,
    overlap: window.overlap,
  };
  if (shift.kind !== 'fixed') {
    return { ...base, openFrom: window.start, closingCap: window.end, eligibility: null, shiftEnd: null };
  }
  const earliest = new Date(
    window.shape.start.getTime() - minutes(shift.earlyWindowMinutes),
  );
  const closingCap = earlier(
    new Date(window.shape.end.getTime() + minutes(shift.maxClosingExtensionMinutes ?? 0)),
    next.window.shape.start,
  );
  return {
    ...base,
    openFrom: later(earliest, previous.window.shape.end),
    closingCap,
    eligibility: { from: earliest.toISOString(), to: closingCap.toISOString() },
    shiftEnd: window.shape.end,
  };
}

/** Facts for every day but the first and last of consecutive shift days. */
export function factsFor(days: readonly ShiftDayInput[]): Map<DateOnly, DayFacts> {
  const facts = new Map<DateOnly, DayFacts>();
  for (let i = 1; i < days.length - 1; i += 1) {
    const fact = dayFacts(days[i - 1]!, days[i]!, days[i + 1]!);
    facts.set(fact.date, fact);
  }
  return facts;
}
