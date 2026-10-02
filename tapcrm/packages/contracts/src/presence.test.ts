import { describe, expect, it } from 'vitest';
import type { AttendanceEventInput, EventKind, EventSource, Evidence } from './people.js';
import {
  KIND_ORDER,
  PRESENCE,
  allowedMoves,
  compareEvents,
  nextState,
  readDay,
  type EligibilityWindow,
} from './presence.js';

let counter = 0;
function event(
  kind: EventKind,
  at: string,
  extra: { source?: EventSource; evidence?: Evidence; id?: string } = {},
): AttendanceEventInput {
  counter += 1;
  return {
    id: extra.id ?? `e${counter}`,
    kind,
    at: `2026-09-28T${at}Z`,
    source: extra.source ?? (kind === 'scan' || kind === 'auto-out' ? 'device' : 'web'),
    evidence:
      extra.evidence ??
      (kind === 'scan' || kind === 'auto-out' ? 'assumed' : 'confirmed'),
    assignmentReason: 'midpoint',
  };
}

/** Every permutation would be slow; reversing and rotating is enough to catch an order dependence. */
function orders<T>(items: readonly T[]): T[][] {
  const out: T[][] = [[...items], [...items].reverse()];
  for (let shift = 1; shift < items.length; shift += 1)
    out.push([...items.slice(shift), ...items.slice(0, shift)]);
  return out;
}

/** Renames ids to prove nothing reads them. */
const renamed = (events: readonly AttendanceEventInput[]) =>
  events.map((e, i) => ({ ...e, id: `z${events.length - i}` }));

function everyWay(
  events: readonly AttendanceEventInput[],
  window: EligibilityWindow = null,
) {
  const first = readDay(events, window);
  for (const order of orders(events)) {
    const again = readDay(order, window);
    expect(again.arrival?.at).toBe(first.arrival?.at);
    expect(again.departure?.at).toBe(first.departure?.at);
    expect(again.state).toBe(first.state);
    const other = readDay(renamed(order), window);
    expect(other.departure?.at).toBe(first.departure?.at);
    expect(other.state).toBe(first.state);
  }
  return first;
}

describe('the state machine is data (§9.1)', () => {
  it('declares the four states and their moves', () => {
    expect(allowedMoves('NOT_IN')).toEqual(['in', 'scan']);
    expect(nextState('WORKING', 'out')).toBe('FINISHED');
    expect(nextState('ON_BREAK', 'scan')).toBe('WORKING');
    expect(allowedMoves('FINISHED')).toEqual([]);
    expect(Object.keys(PRESENCE)).toEqual(['NOT_IN', 'WORKING', 'ON_BREAK', 'FINISHED']);
  });

  it('D32: orders by second, then out, in, scan, break-start, break-end, auto-out', () => {
    expect(KIND_ORDER).toEqual([
      'out',
      'in',
      'scan',
      'break-start',
      'break-end',
      'auto-out',
    ]);
    expect(
      compareEvents(event('in', '09:00:00'), event('out', '09:00:00')),
    ).toBeGreaterThan(0);
    expect(compareEvents(event('in', '09:00:00'), event('in', '09:00:00'))).toBe(0);
    expect(
      compareEvents(event('out', '09:00:01'), event('auto-out', '09:00:00')),
    ).toBeGreaterThan(0);
  });
});

describe('§5.3 — events in the same second, every row of the table', () => {
  it('`in` and `out`, nothing open: arrival at that second, no departure, the `out` conflicting', () => {
    const out = event('out', '09:00:00');
    const reading = everyWay([event('in', '09:00:00'), out]);
    expect(reading.arrival?.at).toBe('2026-09-28T09:00:00.000Z');
    expect(reading.departure).toBeNull();
    expect(reading.state).toBe('WORKING');
    expect(readDay([event('in', '09:00:00'), out], null).notApplied.get(out.id)).toBe(
      'at-arrival-instant',
    );
  });

  it('`scan` and `out`, nothing open: the same', () => {
    const reading = everyWay([event('scan', '09:00:00'), event('out', '09:00:00')]);
    expect(reading.arrival?.kind).toBe('scan');
    expect(reading.departure).toBeNull();
  });

  it('`out` then `in` in one second with a session open ends it first', () => {
    const reading = everyWay([
      event('in', '01:00:00'),
      event('out', '07:30:00'),
      event('in', '07:30:00'),
    ]);
    expect(reading.departure?.at).toBe('2026-09-28T07:30:00.000Z');
    expect(reading.state).toBe('FINISHED');
  });

  it('`in` and `break-start`: arrived, and on break from that second', () => {
    const reading = everyWay([event('break-start', '09:00:00'), event('in', '09:00:00')]);
    expect(reading.state).toBe('ON_BREAK');
    expect(reading.breaks).toEqual([{ from: '2026-09-28T09:00:00.000Z', to: null }]);
  });

  it('`break-start` and `break-end`: a zero-length break', () => {
    const reading = everyWay([
      event('in', '09:00:00'),
      event('break-end', '12:00:00'),
      event('break-start', '12:00:00'),
    ]);
    expect(reading.breaks).toEqual([
      { from: '2026-09-28T12:00:00.000Z', to: '2026-09-28T12:00:00.000Z' },
    ]);
    expect(reading.state).toBe('WORKING');
  });

  it('the last event and an `auto-out`: the auto-out is the departure, even in the arrival’s second', () => {
    const reading = everyWay([event('auto-out', '09:00:00'), event('scan', '09:00:00')]);
    expect(reading.departure?.kind).toBe('auto-out');
  });

  it('two of one kind in one second are one arrival, confirmed if either is', () => {
    const reading = everyWay([
      event('in', '09:00:00', { source: 'device', evidence: 'assumed' }),
      event('in', '09:00:00', { source: 'web', evidence: 'confirmed' }),
    ]);
    expect(reading.arrival?.evidence).toBe('confirmed');
    expect(reading.arrival?.eventIds).toHaveLength(2);
  });
});

describe('D31 — one arrival, one departure', () => {
  it('a double exit swipe at 05:00 and 05:10 is a 05:00 departure; 05:10 is evidence', () => {
    const late = event('out', '05:10:00');
    const reading = readDay(
      [event('in', '00:00:00'), event('out', '05:00:00'), late],
      null,
    );
    expect(reading.departure?.at).toBe('2026-09-28T05:00:00.000Z');
    expect(reading.notApplied.get(late.id)).toBe('after-departure');
  });

  it('an `out` with nothing open is before-arrival, a second `in` is no-move', () => {
    const early = event('out', '08:00:00');
    const second = event('in', '09:30:00');
    const reading = readDay([early, event('in', '09:00:00'), second], null);
    expect(reading.notApplied.get(early.id)).toBe('before-arrival');
    expect(reading.notApplied.get(second.id)).toBe('no-move');
  });

  it('a scan while on break ends the break; a break open at departure ends there', () => {
    const reading = readDay(
      [
        event('in', '09:00:00'),
        event('break-start', '12:00:00'),
        event('scan', '12:40:00'),
        event('break-start', '16:00:00'),
        event('out', '18:00:00'),
      ],
      null,
    );
    expect(reading.breaks).toEqual([
      { from: '2026-09-28T12:00:00.000Z', to: '2026-09-28T12:40:00.000Z' },
      { from: '2026-09-28T16:00:00.000Z', to: '2026-09-28T18:00:00.000Z' },
    ]);
  });
});

describe('§8.2 — the eligibility window', () => {
  const window = { from: '2026-09-28T06:00:00.000Z', to: '2026-09-28T22:00:00.000Z' };

  it('an event outside it is kept, flagged, and never the arrival', () => {
    const stray = event('scan', '05:30:00');
    const reading = readDay([stray, event('in', '08:55:00')], window);
    expect(reading.notApplied.get(stray.id)).toBe('outside-window');
    expect(reading.arrival?.at).toBe('2026-09-28T08:55:00.000Z');
  });

  it('D36: what a correction adds counts wherever it falls', () => {
    const reading = readDay([event('in', '05:30:00', { source: 'correction' })], window);
    expect(reading.arrival?.at).toBe('2026-09-28T05:30:00.000Z');
  });

  it('flexible and no-shift days have no window: everything is eligible', () => {
    expect(readDay([event('in', '02:00:00')], null).arrival?.at).toBe(
      '2026-09-28T02:00:00.000Z',
    );
  });
});
