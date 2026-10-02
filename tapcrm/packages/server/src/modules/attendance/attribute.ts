import type { AssignmentReason, AttendanceEventInput, DateOnly } from '@tapcrm/contracts';
import { compareEvents, readDay } from '@tapcrm/contracts';
import { addDays } from '../../platform/time.js';
import type { DayFacts } from './day-facts.js';

/**
 * Which day owns an event — design §5.2, D23, D30.
 *
 * For an event e at instant t, with G the day whose window holds t, the first
 * matching rule wins:
 *
 *   1. G+1 claims it   G+1 has already arrived before e       → next-shift-started
 *                      or e is an arrival at or after openFrom(G+1)
 *                         → opening-pull-forward, or next-shift-started when G
 *                           is open at e (G is flagged previous-session-unconfirmed)
 *   2. G claims it     G has already arrived before e         → midpoint
 *                      or e is an arrival at or after openFrom(G)
 *                         → midpoint, or next-shift-started when G−1 is open at e
 *                           (G−1 is flagged previous-session-unconfirmed)
 *   3. G−1 claims it   G−1 is open at e                       → closing-extension
 *                      (an `in` here also flags G−1 overlapping-arrival)
 *   4. otherwise       → G, midpoint
 *
 * "Arrived" and "open" are read from the events themselves, in the order of
 * D32, never from live state, so replaying a month gives the same answer. A
 * system `auto-out` never counts: auto-close derives it from the real events
 * (D25), and letting it steer attribution would make a day depend on when a
 * late punch was delivered.
 */

export interface Placement {
  readonly date: DateOnly;
  readonly reason: AssignmentReason;
}

export interface LedgerEvent {
  readonly event: AttendanceEventInput;
  /** Where the event stays: pinned, or outside the days being re-attributed. */
  readonly fixed?: Placement;
}

export interface Attribution {
  readonly placements: ReadonlyMap<string, Placement>;
  /** Day flags attribution raises: previous-session-unconfirmed, overlapping-arrival. */
  readonly flags: ReadonlyMap<DateOnly, ReadonlySet<string>>;
}

const ARRIVALS = new Set(['in', 'scan']);

/** The day whose window holds `at`. */
export function dayOfWindow(
  facts: ReadonlyMap<DateOnly, DayFacts>,
  at: Date,
): DayFacts | undefined {
  for (const fact of facts.values()) {
    if (fact.windowStart <= at && at < fact.windowEnd) return fact;
  }
  return undefined;
}

/** The day's events so far, without system auto-outs, as the rules read them. */
class Placed {
  private readonly byDate = new Map<DateOnly, AttendanceEventInput[]>();

  add(date: DateOnly, event: AttendanceEventInput): void {
    if (event.kind === 'auto-out') return;
    this.byDate.set(date, [...(this.byDate.get(date) ?? []), event]);
  }

  private reading(fact: DayFacts | undefined) {
    if (fact === undefined) return null;
    return readDay(this.byDate.get(fact.date) ?? [], fact.eligibility);
  }

  arrived(fact: DayFacts | undefined): boolean {
    return this.reading(fact)?.arrival != null;
  }

  /** Arrived, not departed, and `at` no later than its closing cap. */
  open(fact: DayFacts | undefined, at: Date): boolean {
    const reading = this.reading(fact);
    return (
      fact !== undefined &&
      reading?.arrival != null &&
      reading.departure === null &&
      at <= fact.closingCap
    );
  }
}

function neighbour(
  facts: ReadonlyMap<DateOnly, DayFacts>,
  date: DateOnly,
  days: number,
): DayFacts | undefined {
  return facts.get(addDays(date, days));
}

function decide(
  facts: ReadonlyMap<DateOnly, DayFacts>,
  placed: Placed,
  event: AttendanceEventInput,
  flag: (date: DateOnly, name: string) => void,
): Placement | null {
  const at = new Date(event.at);
  const g = dayOfWindow(facts, at);
  if (g === undefined) return null;
  const next = neighbour(facts, g.date, 1);
  const previous = neighbour(facts, g.date, -1);
  const arrival = ARRIVALS.has(event.kind);

  // 1. The next day claims it.
  if (next !== undefined) {
    if (placed.arrived(next)) return { date: next.date, reason: 'next-shift-started' };
    if (arrival && at >= next.openFrom) {
      if (placed.open(g, at)) {
        flag(g.date, 'previous-session-unconfirmed');
        return { date: next.date, reason: 'next-shift-started' };
      }
      return { date: next.date, reason: 'opening-pull-forward' };
    }
  }

  // 2. Its own day claims it.
  if (placed.arrived(g)) return { date: g.date, reason: 'midpoint' };
  if (arrival && at >= g.openFrom) {
    if (placed.open(previous, at)) {
      flag(previous!.date, 'previous-session-unconfirmed');
      return { date: g.date, reason: 'next-shift-started' };
    }
    return { date: g.date, reason: 'midpoint' };
  }

  // 3. The previous day's session is still open: the closing extension, every kind.
  if (placed.open(previous, at)) {
    if (event.kind === 'in') flag(previous!.date, 'overlapping-arrival');
    return { date: previous!.date, reason: 'closing-extension' };
  }

  // 4. The midpoint.
  return { date: g.date, reason: 'midpoint' };
}

/**
 * Attributes every event, in the order of D32. Events of one kind in one second
 * are one piece of evidence and land together. An event with `fixed` keeps
 * that placement and still counts for the events after it.
 */
export function attributeAll(
  ledger: readonly LedgerEvent[],
  facts: ReadonlyMap<DateOnly, DayFacts>,
): Attribution {
  const ordered = [...ledger].sort(
    (a, b) => compareEvents(a.event, b.event) || a.event.id.localeCompare(b.event.id),
  );
  const placements = new Map<string, Placement>();
  const flags = new Map<DateOnly, Set<string>>();
  const flag = (date: DateOnly, name: string) =>
    flags.set(date, new Set([...(flags.get(date) ?? []), name]));
  const placed = new Placed();

  let lastKey = '';
  let lastPlacement: Placement | null = null;
  for (const { event, fixed } of ordered) {
    const key = `${new Date(event.at).toISOString()}|${event.kind}`;
    let placement: Placement | null;
    if (fixed !== undefined) placement = fixed;
    else if (key === lastKey) placement = lastPlacement;
    else placement = decide(facts, placed, event, flag);
    lastKey = key;
    lastPlacement = placement;
    if (placement === null) continue;
    placements.set(event.id, placement);
    placed.add(placement.date, event);
  }
  return { placements, flags };
}

/**
 * `AttendanceFacade.currentDayFor` — the day a person is IN at an instant
 * (§5.2): geometry, extended while their previous session is open, released
 * once the next day has an arrival. "By `at`" counts events up to and
 * including that second.
 */
export function currentDay(
  facts: ReadonlyMap<DateOnly, DayFacts>,
  events: readonly { readonly event: AttendanceEventInput; readonly date: DateOnly }[],
  at: Date,
): DateOnly | null {
  const g = dayOfWindow(facts, at);
  if (g === undefined) return null;
  const upTo = Math.floor(at.getTime() / 1000) * 1000 + 999;
  const placed = new Placed();
  for (const { event, date } of [...events].sort((a, b) =>
    compareEvents(a.event, b.event),
  )) {
    if (Date.parse(event.at) <= upTo) placed.add(date, event);
  }
  const next = neighbour(facts, g.date, 1);
  const previous = neighbour(facts, g.date, -1);
  if (placed.arrived(next)) return next!.date;
  if (placed.arrived(g)) return g.date;
  if (placed.open(previous, at)) return previous!.date;
  return g.date;
}
