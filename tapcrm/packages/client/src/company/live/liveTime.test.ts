import { describe, expect, it } from 'vitest';
import { liveMinutes } from './liveTime.js';

const NOW = Date.parse('2026-11-13T12:00:00Z');
const minutesAgo = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();

describe('liveMinutes', () => {
  it('keeps counting work while the person is working', () => {
    const row = { state: 'WORKING' as const, since: minutesAgo(30), workedMinutes: 60, breakMinutes: 15, minutesAsOf: minutesAgo(30) };
    expect(liveMinutes(row, NOW)).toEqual({ worked: 90, onBreak: 15 });
    expect(liveMinutes(row, NOW + 10 * 60_000)).toEqual({ worked: 100, onBreak: 15 });
  });

  it('counts only the time since the minutes were worked out, not the whole stretch again', () => {
    // Worked out 10 minutes ago, 50 minutes into the current stretch.
    const row = { state: 'WORKING' as const, since: minutesAgo(60), workedMinutes: 170, breakMinutes: 0, minutesAsOf: minutesAgo(10) };
    expect(liveMinutes(row, NOW).worked).toBe(180);
  });

  it('counts the break, not work, while on a break', () => {
    const row = { state: 'ON_BREAK' as const, since: minutesAgo(5), workedMinutes: 120, breakMinutes: 10, minutesAsOf: minutesAgo(5) };
    expect(liveMinutes(row, NOW)).toEqual({ worked: 120, onBreak: 15 });
  });

  it('falls back to the start of the stretch for older rows', () => {
    const row = { state: 'WORKING' as const, since: minutesAgo(20), workedMinutes: 40, breakMinutes: 0 };
    expect(liveMinutes(row, NOW).worked).toBe(60);
  });

  it('leaves a finished day as it is', () => {
    const row = { state: 'FINISHED' as const, since: minutesAgo(90), workedMinutes: 480, breakMinutes: 45, minutesAsOf: minutesAgo(90) };
    expect(liveMinutes(row, NOW)).toEqual({ worked: 480, onBreak: 45 });
  });
});
