import { describe, expect, it } from 'vitest';
import type { DateOnly, ResolvedDay, ResolvedShift } from '@tapcrm/contracts';
import {
  alignUp,
  intersectIntervals,
  leaveOn,
  mergeIntervals,
  slotStarts,
  subtractIntervals,
  workingWindow,
  type Interval,
} from './availability.js';
import { clientReminderDue } from './automation.js';

const at = (iso: string) => new Date(iso).getTime();
const span = (from: string, to: string): Interval => ({ start: at(from), end: at(to) });
const iso = (intervals: Interval[]) => intervals.map((item) => [new Date(item.start).toISOString(), new Date(item.end).toISOString()]);

describe('interval arithmetic', () => {
  it('merges overlapping and touching intervals', () => {
    expect(iso(mergeIntervals([span('2026-11-10T05:00Z', '2026-11-10T06:00Z'), span('2026-11-10T06:00Z', '2026-11-10T07:00Z'), span('2026-11-10T04:00Z', '2026-11-10T04:30Z')])))
      .toEqual([['2026-11-10T04:00:00.000Z', '2026-11-10T04:30:00.000Z'], ['2026-11-10T05:00:00.000Z', '2026-11-10T07:00:00.000Z']]);
  });

  it('takes busy time out of free time', () => {
    const free = [span('2026-11-10T04:30Z', '2026-11-10T12:30Z')];
    const busy = [span('2026-11-10T05:30Z', '2026-11-10T06:30Z'), span('2026-11-10T12:00Z', '2026-11-10T13:00Z')];
    expect(iso(subtractIntervals(free, busy))).toEqual([
      ['2026-11-10T04:30:00.000Z', '2026-11-10T05:30:00.000Z'],
      ['2026-11-10T06:30:00.000Z', '2026-11-10T12:00:00.000Z'],
    ]);
  });

  it('keeps only the time everyone has free', () => {
    const mine = [span('2026-11-10T04:30Z', '2026-11-10T08:00Z')];
    const yours = [span('2026-11-10T06:00Z', '2026-11-10T12:30Z')];
    expect(iso(intersectIntervals(mine, yours))).toEqual([['2026-11-10T06:00:00.000Z', '2026-11-10T08:00:00.000Z']]);
  });
});

describe('slots', () => {
  it('starts slots on the hour and half hour of the local clock', () => {
    // 10:07 IST rounds up to 10:30 IST (05:00Z).
    expect(new Date(alignUp(at('2026-11-10T04:37Z'), 30, 'Asia/Kolkata')).toISOString()).toBe('2026-11-10T05:00:00.000Z');
    // Kathmandu is UTC+5:45: its half hours are :15 and :45 past in UTC.
    expect(new Date(alignUp(at('2026-11-10T04:20Z'), 30, 'Asia/Kathmandu')).toISOString()).toBe('2026-11-10T04:45:00.000Z');
  });

  it('fits whole meetings into the free time', () => {
    const free = [span('2026-11-10T04:30Z', '2026-11-10T06:00Z')];
    const starts = slotStarts(free, 45, 30, 'Asia/Kolkata', at('2026-11-10T00:00Z'), at('2026-11-11T00:00Z')).map((value) => new Date(value).toISOString());
    expect(starts).toEqual(['2026-11-10T04:30:00.000Z', '2026-11-10T05:00:00.000Z']);
  });

  it('offers nothing before the earliest allowed time', () => {
    const free = [span('2026-11-10T04:30Z', '2026-11-10T07:00Z')];
    const starts = slotStarts(free, 30, 30, 'Asia/Kolkata', at('2026-11-10T05:10Z'), at('2026-11-11T00:00Z'));
    expect(new Date(starts[0]!).toISOString()).toBe('2026-11-10T05:30:00.000Z');
  });
});

describe('working time', () => {
  const date = '2026-11-10' as DateOnly;
  const day = (type: ResolvedDay['type']): ResolvedDay => ({ date, type, holidayId: null, holidayName: null, subtype: null, matchedBy: null });
  const shift = (overrides: Partial<ResolvedShift>): ResolvedShift => ({
    date, source: 'default' as ResolvedShift['source'], shiftId: null, versionId: null, kind: 'fixed', start: '09:30' as ResolvedShift['start'], end: '18:30' as ResolvedShift['end'],
    isOvernight: false, graceMinutes: 0, earlyExitGraceMinutes: 0, fullDayMinutes: 540, halfDayMinutes: 270, complementaryHalfMinutes: null,
    minOvertimeMinutes: null, earlyWindowMinutes: 0, maxClosingExtensionMinutes: null, timezone: 'Asia/Kolkata', ...overrides,
  });

  it('uses the fixed shift on a working day', () => {
    expect(iso([workingWindow(day('working'), shift({}), [], 'Asia/Kolkata')!])).toEqual([['2026-11-10T04:00:00.000Z', '2026-11-10T13:00:00.000Z']]);
  });

  it('counts a flexible shift, or none, as 10:00–18:00', () => {
    expect(iso([workingWindow(day('working'), shift({ kind: 'flexible', start: null, end: null }), [], 'Asia/Kolkata')!]))
      .toEqual([['2026-11-10T04:30:00.000Z', '2026-11-10T12:30:00.000Z']]);
  });

  it('has no time on holidays, week-offs and full days of leave', () => {
    expect(workingWindow(day('holiday'), shift({}), [], 'Asia/Kolkata')).toBeNull();
    expect(workingWindow(day('week-off'), shift({}), [], 'Asia/Kolkata')).toBeNull();
    expect(workingWindow(day('working'), shift({}), [{ fromDate: date, toDate: date, fromHalf: 'full', toHalf: 'full' }], 'Asia/Kolkata')).toBeNull();
  });

  it('keeps the other half of a half day of leave', () => {
    const firstHalfOff = workingWindow(day('working'), shift({}), [{ fromDate: date, toDate: date, fromHalf: 'first', toHalf: 'first' }], 'Asia/Kolkata')!;
    expect(iso([firstHalfOff])).toEqual([['2026-11-10T08:30:00.000Z', '2026-11-10T13:00:00.000Z']]);
  });

  it('reads which part of each day a leave takes', () => {
    const leave = { fromDate: '2026-11-09' as DateOnly, toDate: '2026-11-11' as DateOnly, fromHalf: 'second' as const, toHalf: 'first' as const };
    expect(leaveOn('2026-11-09' as DateOnly, leave)).toBe('second');
    expect(leaveOn('2026-11-10' as DateOnly, leave)).toBe('full');
    expect(leaveOn('2026-11-11' as DateOnly, leave)).toBe('first');
    expect(leaveOn('2026-11-12' as DateOnly, leave)).toBeNull();
  });
});

describe('client reminders', () => {
  const startsAt = new Date('2026-11-12T09:30:00Z');
  const longAgo = new Date('2026-11-01T00:00:00Z');
  it('sends the day-before reminder, then the hour-before one', () => {
    expect(clientReminderDue(startsAt, longAgo, new Date('2026-11-11T08:00:00Z'))).toBeNull();
    expect(clientReminderDue(startsAt, longAgo, new Date('2026-11-11T09:31:00Z'))).toBe('client_24h');
    expect(clientReminderDue(startsAt, longAgo, new Date('2026-11-12T08:31:00Z'))).toBe('client_1h');
    expect(clientReminderDue(startsAt, longAgo, new Date('2026-11-12T09:31:00Z'))).toBeNull();
  });

  it('skips the day-before reminder for a meeting confirmed the same day', () => {
    const confirmed = new Date('2026-11-12T04:00:00Z');
    expect(clientReminderDue(startsAt, confirmed, new Date('2026-11-12T05:00:00Z'))).toBeNull();
    expect(clientReminderDue(startsAt, confirmed, new Date('2026-11-12T08:35:00Z'))).toBe('client_1h');
  });
});
