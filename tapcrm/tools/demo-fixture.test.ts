import { describe, expect, it } from 'vitest';
import { demoDates } from './demo-fixture.js';

describe('demoDates', () => {
  it('selects eight past weekdays and the next future weekday across month boundaries', () => {
    const dates = demoDates('2026-09-30');
    expect(dates.workdays).toHaveLength(8);
    expect(dates.workdays[0]).toBe('2026-09-18');
    expect(dates.workdays.at(-1)).toBe('2026-09-29');
    expect(dates.futureLeave).toBe('2026-10-01');
    expect(dates.monthStart).toBe('2026-09-01');
    expect(dates.joinedOn).toBe('2025-09-01');
  });

  it('does not schedule a weekend leave date', () => {
    const dates = demoDates('2026-10-02');
    expect(dates.futureLeave).toBe('2026-10-05');
  });
});
