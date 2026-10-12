import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';
import { BUSINESS_HOURS, computeSlaDueAt, isBreached, minutesPastSla } from './sla.js';

/** Convenience: a Monday 10:00 IST reference anchor. */
const MON_10_IST = DateTime.fromISO('2026-10-12T10:00:00', { zone: 'Asia/Kolkata' }).toJSDate();

describe('computeSlaDueAt — within business day', () => {
  it('Monday 10:00 IST + 4h = Monday 14:00 IST', () => {
    const due = DateTime.fromJSDate(computeSlaDueAt(MON_10_IST)).setZone('Asia/Kolkata');
    expect(due.toFormat('yyyy-LL-dd HH:mm')).toBe('2026-10-12 14:00');
  });

  it('Monday 17:00 IST + 4h rolls into Tuesday 12:00 IST', () => {
    const mon17 = DateTime.fromISO('2026-10-12T17:00:00', { zone: 'Asia/Kolkata' }).toJSDate();
    const due = DateTime.fromJSDate(computeSlaDueAt(mon17)).setZone('Asia/Kolkata');
    expect(due.toFormat('yyyy-LL-dd HH:mm')).toBe('2026-10-13 12:00');
  });
});

describe('computeSlaDueAt — outside the business window', () => {
  it('Monday 06:00 IST clamps to Monday 10:00 start, +4h = 14:00', () => {
    const mon06 = DateTime.fromISO('2026-10-12T06:00:00', { zone: 'Asia/Kolkata' }).toJSDate();
    const due = DateTime.fromJSDate(computeSlaDueAt(mon06)).setZone('Asia/Kolkata');
    expect(due.toFormat('yyyy-LL-dd HH:mm')).toBe('2026-10-12 14:00');
  });

  it('Saturday 11:00 IST clamps to Monday 10:00 + 4h = 14:00', () => {
    const sat = DateTime.fromISO('2026-10-10T11:00:00', { zone: 'Asia/Kolkata' }).toJSDate();
    const due = DateTime.fromJSDate(computeSlaDueAt(sat)).setZone('Asia/Kolkata');
    expect(due.toFormat('yyyy-LL-dd HH:mm')).toBe('2026-10-12 14:00');
  });

  it('Friday 20:00 IST (post-close) clamps to Monday 10:00 + 4h = 14:00', () => {
    const fri = DateTime.fromISO('2026-10-09T20:00:00', { zone: 'Asia/Kolkata' }).toJSDate();
    const due = DateTime.fromJSDate(computeSlaDueAt(fri)).setZone('Asia/Kolkata');
    expect(due.toFormat('yyyy-LL-dd HH:mm')).toBe('2026-10-12 14:00');
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
