import { describe, expect, it } from 'vitest';
import type { ShiftInputs } from './resolve.js';
import { d, fixed, inputs, template } from './fixtures.test-helpers.js';
import { dayWindow, dayWindowContaining } from './windows.js';

/** Instants are written in IST (+05:30), the organization's zone in these tests. */
const at = (local: string) => new Date(`${local}+05:30`);
const iso = (local: string) => at(local).toISOString();

const DAY = fixed('day', '09:00', '18:00');
const NIGHT = fixed('night', '20:00', '05:00');
const EARLY = fixed('early', '04:30', '13:30');

/** Each date's own template, by override, for tables of consecutive days. */
function roster(days: Record<string, string>): ShiftInputs {
  return inputs({
    shiftList: [DAY, NIGHT, EARLY],
    overrides: Object.entries(days).map(([date, shiftId]) => ({
      workDate: d(date),
      kind: 'shift' as const,
      shiftId,
    })),
  });
}

describe('SH-3 / §5.2 — the boundary is the midpoint of the off-duty gap', () => {
  it('day after day: 18:00 → 09:00 puts the boundary at 01:30', () => {
    const window = dayWindow(
      inputs({ shiftList: [DAY], assignments: [template('day')] }),
      d('2026-09-28'),
    );
    expect(window.start.toISOString()).toBe(iso('2026-09-28T01:30:00'));
    expect(window.end.toISOString()).toBe(iso('2026-09-29T01:30:00'));
  });

  it('night after night: the whole night is on its start date, boundary 12:30', () => {
    const window = dayWindow(
      inputs({ shiftList: [NIGHT], assignments: [template('night')] }),
      d('2026-09-26'),
    );
    expect(window.start.toISOString()).toBe(iso('2026-09-26T12:30:00'));
    expect(window.end.toISOString()).toBe(iso('2026-09-27T12:30:00'));
  });

  it('night (ends 05:00 Mon) → morning (09:00 Mon): boundary 07:00 Mon', () => {
    const window = dayWindow(
      roster({ '2026-09-27': 'night', '2026-09-28': 'day' }),
      d('2026-09-27'),
    );
    expect(window.end.toISOString()).toBe(iso('2026-09-28T07:00:00'));
  });

  it('morning (ends 18:00 Mon) → night (20:00 Tue): boundary 07:00 Tue', () => {
    const window = dayWindow(
      roster({ '2026-09-28': 'day', '2026-09-29': 'night' }),
      d('2026-09-28'),
    );
    expect(window.end.toISOString()).toBe(iso('2026-09-29T07:00:00'));
  });

  it('touching shifts: a zero gap puts the boundary at that instant', () => {
    const touching = inputs({
      shiftList: [fixed('a', '21:00', '09:00'), fixed('b', '09:00', '21:00')],
      overrides: [
        { workDate: d('2026-09-28'), kind: 'shift', shiftId: 'a' },
        { workDate: d('2026-09-29'), kind: 'shift', shiftId: 'b' },
      ],
    });
    expect(dayWindow(touching, d('2026-09-28')).end.toISOString()).toBe(
      iso('2026-09-29T09:00:00'),
    );
  });

  it('overlapping neighbours are flagged, never truncated', () => {
    // Sunday 20:00–05:00, then Monday 04:30–13:30 (§5.2).
    const window = dayWindow(
      roster({ '2026-09-27': 'night', '2026-09-28': 'early' }),
      d('2026-09-28'),
    );
    expect(window.overlap).toBe(true);
  });
});

describe('§5.2 — a day with no fixed times borrows an anchor', () => {
  it("a flexible day anchors on the person's assigned template, so a 00:40 finish stays on Monday", () => {
    const anchored = inputs({
      shiftList: [DAY],
      assignments: [template('day')],
      overrides: [{ workDate: d('2026-09-29'), kind: 'flexible', shiftId: null }],
    });
    const monday = dayWindowContaining(anchored, at('2026-09-29T00:40:00'));
    expect(monday.date).toBe('2026-09-28');
    expect(dayWindow(anchored, d('2026-09-29')).shape.anchor).toBe('template');
  });

  it('a day with no shift at all anchors on the day-start time, 00:00 by default', () => {
    const lone = inputs({
      shiftList: [DAY],
      overrides: [{ workDate: d('2026-09-28'), kind: 'shift', shiftId: 'day' }],
    });
    // Monday 18:00 → Tuesday 00:00 anchor: boundary 21:00.
    expect(dayWindow(lone, d('2026-09-28')).end.toISOString()).toBe(
      iso('2026-09-28T21:00:00'),
    );
    expect(dayWindow(lone, d('2026-09-29')).shape.anchor).toBe('day-start');
  });
});

describe('§6.6 — a 20:00–05:00 night, end to end', () => {
  const nights = inputs({ shiftList: [NIGHT], assignments: [template('night')] });

  it('arrival 19:52, break 00:30 and departure 05:06 all fall in the 26th\'s window', () => {
    for (const local of [
      '2026-09-26T19:52:00',
      '2026-09-27T00:30:00',
      '2026-09-27T05:06:00',
    ]) {
      expect(dayWindowContaining(nights, at(local)).date).toBe('2026-09-26');
    }
  });

  it("a 13:10 scan the next afternoon is in the 27th's window", () => {
    expect(dayWindowContaining(nights, at('2026-09-27T13:10:00')).date).toBe(
      '2026-09-27',
    );
  });

  it('a night starting 31 March is a March day', () => {
    expect(dayWindowContaining(nights, at('2027-04-01T04:00:00')).date).toBe(
      '2027-03-31',
    );
  });
});
