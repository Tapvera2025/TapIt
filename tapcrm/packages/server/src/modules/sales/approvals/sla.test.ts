import { describe, expect, it } from 'vitest';
import {
  deviceClockAt,
  instantAt,
  toDateOnly,
  toLocalTime,
} from '../../../platform/time.js';
import { BUSINESS_HOURS, computeSlaDueAt, isBreached, minutesPastSla } from './sla.js';

const IST = 'Asia/Kolkata';

function at(date: string, time: string): Date {
  return instantAt(toDateOnly(date), toLocalTime(time), IST);
}

function formatIst(instant: Date): string {
  // 'YYYY-MM-DD HH:mm:ss' — trim seconds for the SLA assertions.
  return deviceClockAt(instant, IST).slice(0, 'YYYY-MM-DD HH:mm'.length);
}

/** Convenience: a Monday 10:00 IST reference anchor. */
const MON_10_IST = at('2026-10-12', '10:00');

describe('computeSlaDueAt — within business day', () => {
  it('Monday 10:00 IST + 4h = Monday 14:00 IST', () => {
    expect(formatIst(computeSlaDueAt(MON_10_IST))).toBe('2026-10-12 14:00');
  });

  it('Monday 17:00 IST + 4h rolls into Tuesday 12:00 IST', () => {
    expect(formatIst(computeSlaDueAt(at('2026-10-12', '17:00')))).toBe('2026-10-13 12:00');
  });
});

describe('computeSlaDueAt — outside the business window', () => {
  it('Monday 06:00 IST clamps to Monday 10:00 start, +4h = 14:00', () => {
    expect(formatIst(computeSlaDueAt(at('2026-10-12', '06:00')))).toBe('2026-10-12 14:00');
  });

  it('Saturday 11:00 IST clamps to Monday 10:00 + 4h = 14:00', () => {
    expect(formatIst(computeSlaDueAt(at('2026-10-10', '11:00')))).toBe('2026-10-12 14:00');
  });

  it('Friday 20:00 IST (post-close) clamps to Monday 10:00 + 4h = 14:00', () => {
    expect(formatIst(computeSlaDueAt(at('2026-10-09', '20:00')))).toBe('2026-10-12 14:00');
  });
});

describe('isBreached + minutesPastSla', () => {
  it('isBreached is false before the SLA', () => {
    expect(isBreached(new Date('2026-10-12T13:00:00Z'), new Date('2026-10-12T14:00:00Z'))).toBe(false);
  });
  it('isBreached is true at and after the SLA', () => {
    expect(isBreached(new Date('2026-10-12T14:00:00Z'), new Date('2026-10-12T14:00:00Z'))).toBe(true);
  });
  it('minutesPastSla reports a positive number after breach', () => {
    expect(minutesPastSla(new Date('2026-10-12T15:30:00Z'), new Date('2026-10-12T14:00:00Z'))).toBe(90);
  });
});

describe('BUSINESS_HOURS constants', () => {
  it('exposes 9-hour business day (10:00–19:00)', () => {
    expect(BUSINESS_HOURS.start).toBe(10);
    expect(BUSINESS_HOURS.end).toBe(19);
    expect(BUSINESS_HOURS.perDay).toBe(9);
  });
});
