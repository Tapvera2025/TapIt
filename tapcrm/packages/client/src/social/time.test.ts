import { describe, expect, it } from 'vitest';
import { scheduleInZone, scheduleToUtc } from './time.js';
describe('client timezone schedules', () => {
  it('stores an Indian client wall-clock time in UTC independent of the browser timezone', () => {
    expect(scheduleToUtc('2026-10-14T09:30', 'Asia/Kolkata')).toBe(
      '2026-10-14T04:00:00.000Z',
    );
    expect(scheduleInZone('2026-10-14T04:00:00Z', 'Asia/Kolkata')).toBe(
      '2026-10-14T09:30',
    );
  });
  it('rejects nonexistent and ambiguous DST times instead of silently moving a schedule', () => {
    expect(() => scheduleToUtc('2026-03-08T02:30', 'America/New_York')).toThrow(
      /does not exist/,
    );
    expect(() => scheduleToUtc('2026-11-01T01:30', 'America/New_York')).toThrow(
      /occurs twice/,
    );
    expect(scheduleToUtc('2026-11-01T03:30', 'America/New_York')).toBe(
      '2026-11-01T08:30:00.000Z',
    );
  });
});
