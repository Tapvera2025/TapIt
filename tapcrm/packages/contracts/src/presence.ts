import type { AttendanceEventInput, EventKind, Evidence } from './people.js';

/**
 * The presence state machine — design §5.3, §9.1, D26, D31, D32.
 *
 * Declared once, here, and imported by attendance and live-status. Neither
 * module declares a transition of its own. Pure data and pure functions: no
 * table, no tenancy, no I/O.
 */

export type PresenceState = 'NOT_IN' | 'WORKING' | 'ON_BREAK' | 'FINISHED';

export const PRESENCE: Readonly<
  Record<PresenceState, Readonly<Partial<Record<EventKind, PresenceState>>>>
> = {
  NOT_IN: { in: 'WORKING', scan: 'WORKING' },
  WORKING: {
    'break-start': 'ON_BREAK',
    scan: 'WORKING',
    out: 'FINISHED',
    'auto-out': 'FINISHED',
  },
  ON_BREAK: {
    'break-end': 'WORKING',
    scan: 'WORKING',
    out: 'FINISHED',
    'auto-out': 'FINISHED',
  },
  // Nothing reopens a finished day; later events are kept and flagged.
  FINISHED: {},
};

export function nextState(from: PresenceState, kind: EventKind): PresenceState | null {
  return PRESENCE[from][kind] ?? null;
}

export function allowedMoves(from: PresenceState): EventKind[] {
  return Object.keys(PRESENCE[from]) as EventKind[];
}

/**
 * D32 — the order of a day's events: by instant, then by this list. An `out`
 * comes first, so it ends what is open before anything new starts in that
 * second, and can never be the departure of an arrival in the same second.
 * A system `auto-out` is last.
 */
export const KIND_ORDER: readonly EventKind[] = [
  'out',
  'in',
  'scan',
  'break-start',
  'break-end',
  'auto-out',
];

const kindRank = (kind: EventKind): number => KIND_ORDER.indexOf(kind);

/**
 * Negative, zero or positive. Zero means one piece of evidence: same second,
 * same kind. Never looks at ids, sources or when a row was written.
 */
export function compareEvents(
  a: Pick<AttendanceEventInput, 'at' | 'kind'>,
  b: Pick<AttendanceEventInput, 'at' | 'kind'>,
): number {
  return Date.parse(a.at) - Date.parse(b.at) || kindRank(a.kind) - kindRank(b.kind);
}

/**
 * A day's eligibility window (§8.2); null for flexible and no-shift days,
 * where everything assigned to the day is eligible. What a correction adds is
 * eligible wherever it falls (D36).
 */
export type EligibilityWindow = { readonly from: string; readonly to: string } | null;

export interface DayStep {
  readonly at: string;
  readonly kind: EventKind;
  readonly evidence: Evidence;
  /** Every event of this kind in this second: one piece of evidence. */
  readonly eventIds: readonly string[];
}

export type NotApplied =
  | 'outside-window' // not eligible for this day (§8.2)
  | 'before-arrival' // an `out` or a break with nothing open
  | 'at-arrival-instant' // an `out` in the arrival's own second: conflicting evidence
  | 'after-departure' // after the departure in the order
  | 'no-move'; // no move from the state it met, e.g. a second `in`

export interface DayReading {
  readonly state: PresenceState;
  /** The ONE arrival (D31). */
  readonly arrival: DayStep | null;
  /** The ONE departure (D31). */
  readonly departure: DayStep | null;
  /** The ON_BREAK stretches; `to` is null while a break is still open. */
  readonly breaks: readonly { readonly from: string; readonly to: string | null }[];
  /** Every event that moved nothing, and why. */
  readonly notApplied: ReadonlyMap<string, NotApplied>;
}

const ARRIVALS: readonly EventKind[] = ['in', 'scan'];

function eligible(event: AttendanceEventInput, window: EligibilityWindow): boolean {
  if (window === null || event.source === 'correction') return true;
  const at = Date.parse(event.at);
  return at >= Date.parse(window.from) && at <= Date.parse(window.to);
}

interface Group extends DayStep {
  readonly sortKey: Pick<AttendanceEventInput, 'at' | 'kind'>;
}

/** Same second and kind: one piece of evidence, confirmed if any member is (D32). */
function groupEvents(events: readonly AttendanceEventInput[]): Group[] {
  const groups = new Map<
    string,
    { at: string; kind: EventKind; confirmed: boolean; ids: string[] }
  >();
  for (const event of events) {
    const second = new Date(Math.floor(Date.parse(event.at) / 1000) * 1000).toISOString();
    const key = `${second}|${event.kind}`;
    const group = groups.get(key) ?? {
      at: second,
      kind: event.kind,
      confirmed: false,
      ids: [],
    };
    group.confirmed ||= event.evidence === 'confirmed';
    group.ids.push(event.id);
    groups.set(key, group);
  }
  return [...groups.values()]
    .map((group) => ({
      at: group.at,
      kind: group.kind,
      evidence: group.confirmed ? ('confirmed' as const) : ('assumed' as const),
      eventIds: [...group.ids].sort(),
      sortKey: { at: group.at, kind: group.kind },
    }))
    .sort((a, b) => compareEvents(a.sortKey, b.sortKey));
}

const step = (group: Group): DayStep => ({
  at: group.at,
  kind: group.kind,
  evidence: group.evidence,
  eventIds: group.eventIds,
});

/**
 * THE reading of a day (D31, D32): its eligible effective events, grouped by
 * second and kind, walked through PRESENCE in the order above. Nothing else
 * puts a day's events in order.
 */
export function readDay(
  events: readonly AttendanceEventInput[],
  window: EligibilityWindow,
): DayReading {
  const notApplied = new Map<string, NotApplied>();
  const counted: AttendanceEventInput[] = [];
  for (const event of events) {
    if (eligible(event, window)) counted.push(event);
    else notApplied.set(event.id, 'outside-window');
  }
  const groups = groupEvents(counted);

  let state: PresenceState = 'NOT_IN';
  let arrival: DayStep | null = null;
  let departure: DayStep | null = null;
  const breaks: { from: string; to: string | null }[] = [];
  const mark = (group: Group, why: NotApplied) => {
    for (const id of group.eventIds) notApplied.set(id, why);
  };

  for (let index = 0; index < groups.length; index += 1) {
    const group = groups[index]!;
    if (departure !== null) {
      mark(group, 'after-departure');
      continue;
    }
    const next = nextState(state, group.kind);
    if (next === null) {
      if (state !== 'NOT_IN') {
        mark(group, 'no-move');
        continue;
      }
      // Nothing is open. An `out` in the second the day arrives is conflicting
      // evidence, not a departure (D32).
      const arrivesThisSecond = groups
        .slice(index + 1)
        .some((later) => later.at === group.at && ARRIVALS.includes(later.kind));
      const endsSomething = group.kind === 'out' || group.kind === 'auto-out';
      mark(
        group,
        endsSomething && arrivesThisSecond ? 'at-arrival-instant' : 'before-arrival',
      );
      continue;
    }
    if (state === 'NOT_IN') arrival = step(group);
    if (state === 'ON_BREAK' && next !== 'ON_BREAK') {
      const open = breaks[breaks.length - 1];
      if (open !== undefined && open.to === null) open.to = group.at;
    }
    if (next === 'ON_BREAK' && state !== 'ON_BREAK')
      breaks.push({ from: group.at, to: null });
    if (next === 'FINISHED') departure = step(group);
    state = next;
  }

  return { state, arrival, departure, breaks, notApplied };
}

export const arrivalOf = (
  events: readonly AttendanceEventInput[],
  window: EligibilityWindow,
) => readDay(events, window).arrival;
export const departureOf = (
  events: readonly AttendanceEventInput[],
  window: EligibilityWindow,
) => readDay(events, window).departure;
export const replay = (
  events: readonly AttendanceEventInput[],
  window: EligibilityWindow,
) => readDay(events, window).state;

/**
 * The port live-status implements and attendance calls inside `appendEvent`
 * (design §4, LS-1). Generic over the transaction type, because contracts
 * knows nothing about the database.
 */
export interface PresenceProjector<Tx> {
  /** One step of the state machine, for an eligible punch later than everything on its day. */
  apply(tx: Tx, userId: string, event: AttendanceEventInput): Promise<void>;
  /** Rebuild the person's row from their current day's effective events. */
  refresh(tx: Tx, userId: string, now: Date): Promise<void>;
}
