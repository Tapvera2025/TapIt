import { describe, expect, it } from 'vitest';
import { clip, dayCount, formatDay, formatDayRange, formatMonth, inBatches } from './format.js';

describe('notification text helpers', () => {
  it('formats calendar dates as written, with no time zone shift', () => {
    expect(formatDay('2026-11-10')).toBe('10 Nov 2026');
    expect(formatDay('2026-01-01')).toBe('1 Jan 2026');
    expect(formatDay('not a date')).toBe('not a date');
  });

  it('formats ranges compactly', () => {
    expect(formatDayRange('2026-11-10', '2026-11-10')).toBe('10 Nov 2026');
    expect(formatDayRange('2026-11-10', '2026-11-12')).toBe('10–12 Nov 2026');
    expect(formatDayRange('2026-11-28', '2026-12-02')).toBe('28 Nov – 2 Dec 2026');
    expect(formatDayRange('2026-12-30', '2027-01-02')).toBe('30 Dec 2026 – 2 Jan 2027');
  });

  it('names a month and counts days', () => {
    expect(formatMonth('2026-09-01')).toBe('September 2026');
    expect(dayCount(1)).toBe('1 day');
    expect(dayCount(0.5)).toBe('0.5 days');
    expect(dayCount(3)).toBe('3 days');
  });

  it('clips long text and flattens whitespace', () => {
    expect(clip('a\n  b', 10)).toBe('a b');
    const long = clip('x'.repeat(300), 200);
    expect(long).toHaveLength(200);
    expect(long.endsWith('…')).toBe(true);
  });

  it('splits recipients into batches', () => {
    const ids = Array.from({ length: 1201 }, (_, i) => String(i));
    expect(inBatches(ids).map((b) => b.length)).toEqual([500, 500, 201]);
    expect(inBatches([])).toEqual([]);
  });
});
