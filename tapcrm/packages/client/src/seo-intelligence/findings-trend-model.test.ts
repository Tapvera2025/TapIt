import { afterEach, describe, expect, it } from 'vitest';
import { findingsTrendRows, formatTrendDay } from './findings-trend-model.js';

const originalTimezone = process.env['TZ'];
afterEach(() => {
  if (originalTimezone === undefined) delete process.env['TZ'];
  else process.env['TZ'] = originalTimezone;
});

describe('findings trend data', () => {
  it('orders calendar days and keeps severity counts and totals aligned', () => {
    expect(findingsTrendRows([
      { day: '2026-10-26', severity: 'critical', openCount: 2 },
      { day: '2026-10-25', severity: 'high', openCount: 4 },
      { day: '2026-10-26', severity: 'high', openCount: 3 },
    ])).toEqual([
      { day: '2026-10-25', counts: { critical: 0, high: 4, moderate: 0, low: 0, informational: 0 }, total: 4 },
      { day: '2026-10-26', counts: { critical: 2, high: 3, moderate: 0, low: 0, informational: 0 }, total: 5 },
    ]);
  });

  it('does not shift UTC calendar labels for viewers west or east of UTC', () => {
    const labels = ['America/Los_Angeles', 'Asia/Kolkata', 'Pacific/Auckland'].map(timezone => {
      process.env['TZ'] = timezone;
      return formatTrendDay('2026-10-26', true);
    });
    expect(new Set(labels).size).toBe(1);
    expect(labels[0]).toContain('26');
    expect(labels[0]).toContain('2026');
  });

  it('preserves zero-count days and empty data', () => {
    expect(findingsTrendRows([])).toEqual([]);
    expect(findingsTrendRows([{ day: '2026-10-26', severity: 'critical', openCount: 0 }])[0]?.total).toBe(0);
  });
});
