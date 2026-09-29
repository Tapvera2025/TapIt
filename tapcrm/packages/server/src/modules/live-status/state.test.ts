import { describe, expect, it } from 'vitest';
import type { AttendanceEventInput, DateOnly } from '@tapcrm/contracts';
import { deriveRow } from './state.js';

const d = (v: string) => v as DateOnly;
const ist = (local: string) => new Date(`${local}+05:30`);

/** Helpers for building fixtures. */
let idCounter = 0;
const event = (
  kind: AttendanceEventInput['kind'],
  local: string,
  evidence: AttendanceEventInput['evidence'] = 'confirmed',
): AttendanceEventInput => ({
  id: `e${++idCounter}`,
  kind,
  at: ist(local).toISOString(),
  source: 'web',
  evidence,
  assignmentReason: 'midpoint',
});

/** A 09:00–18:00 day shift on 2026-10-05. Window ends at 01:30 next day (midpoint with next day's 09:00). */
const daySpec = {
  workDate: d('2026-10-05'),
  window: {
    start: ist('2026-10-05T01:30:00'),
    end: ist('2026-10-06T01:30:00'),
    eligibility: {
      from: ist('2026-10-05T06:00:00').toISOString(),
      to: ist('2026-10-06T04:00:00').toISOString(),
    } as const,
  },
  shift: {
    startAt: ist('2026-10-05T09:00:00'),
    endAt: ist('2026-10-05T18:00:00'),
    graceMinutes: 10,
    flexibleTargetMinutes: null,
  },
  isWfh: false,
  dayGroup: null,
  closingCap: ist('2026-10-05T22:00:00'), // 4-hour extension
  nextShiftStart: ist('2026-10-06T09:00:00'),
};

/** A 20:00–05:00 night shift on 2026-10-05. Its window: yesterday's 12:30 → today's 12:30. */
const nightSpec = {
  workDate: d('2026-10-05'),
  window: {
    start: ist('2026-10-05T12:30:00'),
    end: ist('2026-10-06T12:30:00'),
    eligibility: {
      from: ist('2026-10-05T17:00:00').toISOString(),
      to: ist('2026-10-06T09:00:00').toISOString(),
    } as const,
  },
  shift: {
    startAt: ist('2026-10-05T20:00:00'),
    endAt: ist('2026-10-06T05:00:00'),
    graceMinutes: 10,
    flexibleTargetMinutes: null,
  },
  isWfh: false,
  dayGroup: null,
  closingCap: ist('2026-10-06T09:00:00'), // 4-hour extension past 05:00
  nextShiftStart: ist('2026-10-06T20:00:00'),
};

describe('deriveRow — presence and minutes', () => {
  it('empty events → NOT_IN, 0/0 minutes, rollover at window_end', () => {
    const row = deriveRow({ ...daySpec, events: [], now: ist('2026-10-05T09:00:00') });
    expect(row.state).toBe('NOT_IN');
    expect(row.workedMinutes).toBe(0);
    expect(row.breakMinutes).toBe(0);
    expect(row.since).toBeNull();
    expect(row.rolloverDueAt.toISOString()).toBe(daySpec.window.end.toISOString());
  });

  it('a punch-in → WORKING, since = the in, rollover at min(shift_end, window_end)', () => {
    const row = deriveRow({
      ...daySpec,
      events: [event('in', '2026-10-05T08:55:00')],
      now: ist('2026-10-05T08:56:00'),
    });
    expect(row.state).toBe('WORKING');
    expect(row.since?.toISOString()).toBe(ist('2026-10-05T08:55:00').toISOString());
    expect(row.workedMinutes).toBe(1);
    // shift_end_at (18:00) < window_end (next-day 01:30) → 18:00.
    expect(row.rolloverDueAt.toISOString()).toBe(daySpec.shift.endAt.toISOString());
  });

  it('a full day-in-the-life → FINISHED, minutes carry breaks', () => {
    const row = deriveRow({
      ...daySpec,
      events: [
        event('in', '2026-10-05T09:00:00'),
        event('break-start', '2026-10-05T12:00:00'),
        event('break-end', '2026-10-05T12:30:00'),
        event('out', '2026-10-05T18:00:00'),
      ],
      now: ist('2026-10-05T18:01:00'),
    });
    expect(row.state).toBe('FINISHED');
    expect(row.workedMinutes).toBe(510); // 9h day − 30min break = 8h30m
    expect(row.breakMinutes).toBe(30);
    expect(row.presenceConfidence).toBe('confirmed');
    expect(row.rolloverDueAt.toISOString()).toBe(daySpec.window.end.toISOString());
  });
});

describe('deriveRow — night shift + rollover_due_at', () => {
  it('night in @ 20:00 before shift end (evaluated at 20:01) → rollover at 05:00 (min(shift_end, window_end))', () => {
    const row = deriveRow({
      ...nightSpec,
      events: [event('in', '2026-10-05T20:00:00')],
      now: ist('2026-10-05T20:01:00'),
    });
    expect(row.state).toBe('WORKING');
    // shift_end_at 2026-10-06T05:00, window_end 2026-10-06T12:30 → min = 05:00
    expect(row.rolloverDueAt.toISOString()).toBe(nightSpec.shift.endAt.toISOString());
  });

  it('night session still open at 09:00 (past shift end) with assumed scan at 05:02 → WORKING·assumed, likely_finished_at = 05:00, rollover = 09:00 (closing_cap)', () => {
    const row = deriveRow({
      ...nightSpec,
      events: [
        event('in', '2026-10-05T20:00:00'),
        event('scan', '2026-10-06T05:02:00', 'assumed'),
      ],
      now: ist('2026-10-06T09:00:00'),
    });
    expect(row.state).toBe('WORKING');
    expect(row.presenceConfidence).toBe('assumed');
    expect(row.lastScanAt?.toISOString()).toBe(ist('2026-10-06T05:02:00').toISOString());
    expect(row.likelyFinishedAt?.toISOString()).toBe(nightSpec.shift.endAt.toISOString());
    // Past shift end, still open → min(closing_cap = 2026-10-06T09:00, next_shift_start = 2026-10-06T20:00) → 09:00
    expect(row.rolloverDueAt.toISOString()).toBe(nightSpec.closingCap.toISOString());
  });

  it('night out @ 04:45 (FINISHED before shift end) → rollover at window_end 12:30, NOT shift_end 05:00', () => {
    const row = deriveRow({
      ...nightSpec,
      events: [
        event('in', '2026-10-05T20:00:00'),
        event('out', '2026-10-06T04:45:00'),
      ],
      now: ist('2026-10-06T04:46:00'),
    });
    expect(row.state).toBe('FINISHED');
    expect(row.rolloverDueAt.toISOString()).toBe(nightSpec.window.end.toISOString());
    // Sanity: 12:30 ≠ 05:00
    expect(row.rolloverDueAt.toISOString()).not.toBe(nightSpec.shift.endAt.toISOString());
  });
});

describe('deriveRow — presence_confidence', () => {
  it('a WORKING day whose last event is a confirmed scan → confirmed', () => {
    const row = deriveRow({
      ...daySpec,
      events: [event('in', '2026-10-05T09:00:00'), event('scan', '2026-10-05T13:00:00', 'confirmed')],
      now: ist('2026-10-05T13:01:00'),
    });
    expect(row.state).toBe('WORKING');
    expect(row.presenceConfidence).toBe('confirmed');
  });
});
