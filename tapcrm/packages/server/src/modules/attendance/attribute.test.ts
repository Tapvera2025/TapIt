import { describe, expect, it } from 'vitest';
import type { AttendanceEventInput } from '@tapcrm/contracts';
import { attributeAll, currentDay, type LedgerEvent } from './attribute.js';
import { d, ist, punch, rosterFacts } from './facts.test-helpers.js';

/**
 * Design §5.2 — every row of the attribution table. Sunday 27 September is a
 * 20:00–05:00 night, Monday a 09:00–18:00 morning; a 4-hour closing extension
 * and a 3-hour early window give closingCap(Sunday) = 09:00 and
 * openFrom(Monday) = 06:00. The geometric boundary is 07:00.
 */
const NIGHT = ['20:00', '05:00'] as const;
const DAY = ['09:00', '18:00'] as const;
const facts = rosterFacts({
  '2026-09-25': NIGHT,
  '2026-09-26': NIGHT,
  '2026-09-27': NIGHT,
  '2026-09-28': DAY,
  '2026-09-29': DAY,
  '2026-09-30': DAY,
});
const SUN = d('2026-09-27');
const MON = d('2026-09-28');

const ledger = (events: AttendanceEventInput[]): LedgerEvent[] =>
  events.map((event) => ({ event }));
const placementOf = (events: AttendanceEventInput[], target: AttendanceEventInput) =>
  attributeAll(ledger(events), facts).placements.get(target.id);

const arrived = punch('in', '2026-09-27T19:55:00');

describe('§5.2 — which day owns an event, row by row', () => {
  it('the facts: closingCap(Sunday) 09:00, openFrom(Monday) 06:00, boundary 07:00', () => {
    expect(facts.get(SUN)!.closingCap).toEqual(ist('2026-09-28T09:00:00'));
    expect(facts.get(MON)!.openFrom).toEqual(ist('2026-09-28T06:00:00'));
    expect(facts.get(SUN)!.windowEnd).toEqual(ist('2026-09-28T07:00:00'));
  });

  it('05:20 out → Sunday (rule 2: Sunday has started)', () => {
    const out = punch('out', '2026-09-28T05:20:00');
    expect(placementOf([arrived, out], out)).toEqual({ date: SUN, reason: 'midpoint' });
  });

  it('07:30 out with the night still open → Sunday (rule 3)', () => {
    const out = punch('out', '2026-09-28T07:30:00');
    expect(placementOf([arrived, out], out)).toEqual({
      date: SUN,
      reason: 'closing-extension',
    });
  });

  it('07:30:00 out and 07:30:00 in, night open → the out Sunday, the in Monday (3, then 2)', () => {
    const out = punch('out', '2026-09-28T07:30:00');
    const inn = punch('in', '2026-09-28T07:30:00');
    for (const events of [
      [arrived, out, inn],
      [inn, out, arrived],
    ]) {
      const { placements } = attributeAll(ledger(events), facts);
      expect(placements.get(out.id)).toEqual({ date: SUN, reason: 'closing-extension' });
      expect(placements.get(inn.id)).toEqual({ date: MON, reason: 'midpoint' });
    }
  });

  it('07:10 break-start, 07:20 break-end, then 07:30 out → all Sunday (the extension takes every kind)', () => {
    const events = [
      arrived,
      punch('break-start', '2026-09-28T07:10:00'),
      punch('break-end', '2026-09-28T07:20:00'),
      punch('out', '2026-09-28T07:30:00'),
    ];
    const { placements } = attributeAll(ledger(events), facts);
    for (const event of events.slice(1))
      expect(placements.get(event.id)).toEqual({
        date: SUN,
        reason: 'closing-extension',
      });
  });

  it('09:05 out, past the cap → Monday, as conflicting evidence (rule 4)', () => {
    const out = punch('out', '2026-09-28T09:05:00');
    expect(placementOf([arrived, out], out)).toEqual({ date: MON, reason: 'midpoint' });
  });

  const closed = punch('out', '2026-09-28T05:02:00');

  it('06:30 in after the night closed at 05:02 → Monday, pulled forward (rule 1)', () => {
    const inn = punch('in', '2026-09-28T06:30:00');
    expect(placementOf([arrived, closed, inn], inn)).toEqual({
      date: MON,
      reason: 'opening-pull-forward',
    });
  });

  it('06:45 break-start after that 06:30 in → Monday (rule 1: Monday has started)', () => {
    const inn = punch('in', '2026-09-28T06:30:00');
    const brk = punch('break-start', '2026-09-28T06:45:00');
    expect(placementOf([arrived, closed, inn, brk], brk)).toEqual({
      date: MON,
      reason: 'next-shift-started',
    });
  });

  it('07:30 out after the night closed at 05:02 → Monday (rule 4: nothing open)', () => {
    const out = punch('out', '2026-09-28T07:30:00');
    expect(placementOf([arrived, closed, out], out)).toEqual({
      date: MON,
      reason: 'midpoint',
    });
  });

  it('08:50 in, night never closed → Monday; Sunday flagged previous-session-unconfirmed (rule 2)', () => {
    const inn = punch('in', '2026-09-28T08:50:00');
    const result = attributeAll(ledger([arrived, inn]), facts);
    expect(result.placements.get(inn.id)).toEqual({
      date: MON,
      reason: 'next-shift-started',
    });
    expect([...(result.flags.get(SUN) ?? [])]).toEqual(['previous-session-unconfirmed']);
  });

  it('08:55 break-start after that → Monday (rule 2)', () => {
    const inn = punch('in', '2026-09-28T08:50:00');
    const brk = punch('break-start', '2026-09-28T08:55:00');
    expect(placementOf([arrived, inn, brk], brk)).toEqual({
      date: MON,
      reason: 'midpoint',
    });
  });

  it('07:30 out delivered after a 05:00 auto-out → Sunday: the auto-out does not count (rule 3)', () => {
    const autoOut = punch('auto-out', '2026-09-28T05:00:00', { source: 'system' });
    const out = punch('out', '2026-09-28T07:30:00');
    const events: LedgerEvent[] = [
      { event: arrived },
      { event: autoOut, fixed: { date: SUN, reason: 'system-close' } },
      { event: out },
    ];
    expect(attributeAll(events, facts).placements.get(out.id)).toEqual({
      date: SUN,
      reason: 'closing-extension',
    });
  });

  it('an `in` reaching the closing extension, before the next opening, is flagged overlapping-arrival (rule 3)', () => {
    // A 20:00–07:00 night before a 14:00 start: boundary 10:30, closingCap 11:00, openFrom 11:00.
    const late = rosterFacts({
      '2026-09-26': ['20:00', '07:00'],
      '2026-09-27': ['20:00', '07:00'],
      '2026-09-28': ['14:00', '23:00'],
      '2026-09-29': ['14:00', '23:00'],
    });
    const inn = punch('in', '2026-09-28T10:45:00');
    const result = attributeAll(ledger([arrived, inn]), late);
    expect(result.placements.get(inn.id)).toEqual({
      date: SUN,
      reason: 'closing-extension',
    });
    expect([...(result.flags.get(SUN) ?? [])]).toEqual(['overlapping-arrival']);
  });

  it('two `in`s in one second land on one day with one reason', () => {
    const web = punch('in', '2026-09-28T08:50:00');
    const reader = punch('in', '2026-09-28T08:50:00', {
      source: 'import',
      evidence: 'confirmed',
    });
    const { placements } = attributeAll(ledger([arrived, web, reader]), facts);
    expect(placements.get(web.id)).toEqual(placements.get(reader.id));
  });
});

describe('the answer never depends on delivery order', () => {
  it('every rotation of one set of punches places each punch the same', () => {
    const events = [
      arrived,
      punch('break-start', '2026-09-28T00:30:00'),
      punch('break-end', '2026-09-28T01:00:00'),
      punch('out', '2026-09-28T05:04:00'),
      punch('scan', '2026-09-28T08:50:00'),
      punch('out', '2026-09-28T18:02:00'),
    ];
    const expected = attributeAll(ledger(events), facts).placements;
    for (let shift = 1; shift < events.length; shift += 1) {
      const rotated = [...events.slice(shift), ...events.slice(0, shift)];
      expect(attributeAll(ledger(rotated), facts).placements).toEqual(expected);
    }
  });
});

describe('night after night (§5.2, §6.6)', () => {
  const nights = rosterFacts({
    '2026-09-25': NIGHT,
    '2026-09-26': NIGHT,
    '2026-09-27': NIGHT,
    '2026-09-28': NIGHT,
    '2026-09-29': NIGHT,
  });

  it('a 07:30 scan stays with the night; a 13:10 errand scan falls to the next day', () => {
    const scan = punch('scan', '2026-09-28T07:30:00');
    const errand = punch('scan', '2026-09-28T13:10:00');
    const { placements } = attributeAll(ledger([arrived, scan, errand]), nights);
    expect(placements.get(scan.id)?.date).toBe(SUN);
    expect(placements.get(errand.id)).toEqual({ date: MON, reason: 'midpoint' });
  });
});

describe('currentDayFor — the day a person is in (§5.2)', () => {
  const placedAs = (events: AttendanceEventInput[]) => {
    const { placements } = attributeAll(ledger(events), facts);
    return events.map((event) => ({ event, date: placements.get(event.id)!.date }));
  };

  it('06:30 in pulled forward → Monday at once', () => {
    const events = placedAs([arrived, closed(), punch('in', '2026-09-28T06:30:00')]);
    expect(currentDay(facts, events, ist('2026-09-28T06:30:00'))).toBe(MON);
  });

  it('07:30 with the night still open → Sunday; once the out is recorded → Monday', () => {
    expect(currentDay(facts, placedAs([arrived]), ist('2026-09-28T07:30:00'))).toBe(SUN);
    const withOut = placedAs([arrived, punch('out', '2026-09-28T07:30:00')]);
    expect(currentDay(facts, withOut, ist('2026-09-28T07:30:00'))).toBe(MON);
  });

  it('08:50 arrival for the morning, night never closed → Monday', () => {
    const events = placedAs([arrived, punch('scan', '2026-09-28T08:50:00')]);
    expect(currentDay(facts, events, ist('2026-09-28T08:50:00'))).toBe(MON);
  });

  function closed() {
    return punch('out', '2026-09-28T05:02:00');
  }
});
