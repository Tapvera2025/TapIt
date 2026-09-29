import { describe, expect, it } from 'vitest';
import {
  addCalendarDays,
  calendarDateLabel,
  calendarMonth,
  calendarWeek,
  shiftCalendarMonth,
  validDateOnly,
} from './calendar-model.js';

describe('organization DateOnly calendar arithmetic', () => {
  it('uses 42 cells for a six-week month and keeps its spillover days ordered', () => {
    const days = calendarMonth('2026-08');
    expect(days).toHaveLength(42);
    expect(days[0]).toBe('2026-07-27');
    expect(days.at(-1)).toBe('2026-09-06');
  });

  it('keeps leap day and overnight month attribution on the original work date', () => {
    expect(validDateOnly('2028-02-29')).toBe(true);
    expect(validDateOnly('2027-02-29')).toBe(false);
    expect(addCalendarDays('2028-02-29', 1)).toBe('2028-03-01');
    expect(calendarWeek('2028-02-29')).toContain('2028-02-29');
    expect(shiftCalendarMonth('2028-02', 1)).toBe('2028-03');
  });

  it('formats the same date in different browser timezones', () => {
    expect(calendarDateLabel('2026-10-31')).toContain('31 October 2026');
    expect(calendarMonth('2026-10')).toContain('2026-10-31');
  });
});
