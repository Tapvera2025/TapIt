import { describe, expect, it } from 'vitest';
import { dayFacts, type ShiftDayInput } from './day-facts.js';
import type { DateOnly, LocalTime, ResolvedShift } from '@tapcrm/contracts';

const BASE_SHIFT: ResolvedShift = {
  date: '2026-01-10' as DateOnly,
  source: 'department-default',
  shiftId: 'shift-1',
  versionId: 'ver-1',
  kind: 'fixed',
  start: '09:00' as LocalTime,
  end: '18:00' as LocalTime,
  isOvernight: false,
  graceMinutes: 5,
  earlyExitGraceMinutes: 5,
  fullDayMinutes: 540,
  halfDayMinutes: 270,
  complementaryHalfMinutes: null,
  minOvertimeMinutes: null,
  earlyWindowMinutes: 30,
  maxClosingExtensionMinutes: 120,
  timezone: 'Asia/Kolkata',
};

const FLEX_SHIFT: ResolvedShift = {
  ...BASE_SHIFT,
  kind: 'flexible',
  start: null,
  end: null,
} as ResolvedShift;

function makeDay(date: string, shift: ResolvedShift, start: Date, end: Date): ShiftDayInput {
  return {
    shift,
    window: {
      date: date as DateOnly,
      start,
      end,
      overlap: false,
      shape: { start, end, anchor: 'self' },
    },
  };
}

describe('dayFacts', () => {
  it('shiftEnd is the raw shift end, closingCap can be later', () => {
    const shiftEndDate = new Date('2026-01-10T12:30:00.000Z'); // 18:00 IST
    const prevEnd     = new Date('2026-01-09T12:30:00.000Z');
    const nextStart   = new Date('2026-01-11T03:30:00.000Z'); // far away — cap uses extension

    const prev = makeDay('2026-01-09', BASE_SHIFT, new Date('2026-01-09T03:30:00.000Z'), prevEnd);
    const day  = makeDay('2026-01-10', BASE_SHIFT, new Date('2026-01-10T03:30:00.000Z'), shiftEndDate);
    const next = makeDay('2026-01-11', BASE_SHIFT, nextStart, new Date('2026-01-11T12:30:00.000Z'));

    const facts = dayFacts(prev, day, next);

    // shiftEnd is the exact shift boundary
    expect(facts.shiftEnd).toEqual(shiftEndDate);
    // closingCap extends beyond shiftEnd by maxClosingExtensionMinutes (120)
    expect(facts.closingCap.getTime()).toBeGreaterThan(shiftEndDate.getTime());
    // The eligibility window's `to` IS closingCap, not shiftEnd
    expect(facts.eligibility?.to).toBe(facts.closingCap.toISOString());
  });

  it('flexible day has null shiftEnd', () => {
    const start = new Date('2026-01-10T03:30:00.000Z');
    const end   = new Date('2026-01-10T20:30:00.000Z');
    const prev  = makeDay('2026-01-09', FLEX_SHIFT, new Date('2026-01-09T03:30:00.000Z'), new Date('2026-01-09T20:30:00.000Z'));
    const day   = makeDay('2026-01-10', FLEX_SHIFT, start, end);
    const next  = makeDay('2026-01-11', FLEX_SHIFT, new Date('2026-01-11T03:30:00.000Z'), new Date('2026-01-11T20:30:00.000Z'));

    const facts = dayFacts(prev, day, next);
    expect(facts.shiftEnd).toBeNull();
    expect(facts.eligibility).toBeNull();
  });
});
