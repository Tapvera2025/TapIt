import { describe, expect, it } from 'vitest';
import type { LocalTime, ResolvedShift } from '@tapcrm/contracts';
import { toDateOnly } from '../../platform/time.js';
import { calculate } from './calculate.js';
import { d, punch } from './facts.test-helpers.js';
import { chunkDates } from './recalculate.js';

describe('chunkDates', () => {
  it('cuts sorted dates into runs of at most 31 calendar days', () => {
    expect(
      chunkDates(
        [
          toDateOnly('2026-03-10'),
          toDateOnly('2026-01-15'),
          toDateOnly('2026-01-01'),
          toDateOnly('2026-02-01'),
          toDateOnly('2026-01-31'),
        ],
        31,
      ),
    ).toEqual([
      [toDateOnly('2026-01-01'), toDateOnly('2026-01-15'), toDateOnly('2026-01-31')],
      [toDateOnly('2026-02-01')],
      [toDateOnly('2026-03-10')],
    ]);
  });

  it('gives nothing for nothing', () => {
    expect(chunkDates([], 31)).toEqual([]);
  });
});

/**
 * AT-3 breaksPaid integration with break policy resolver.
 *
 * Tests the derivation logic used in recalculateRecord:
 *   breaksPaid = policySnapshot?.countsTowardWorkHours ?? true
 *
 * We call calculate() directly since recalculateRecord requires a DB transaction.
 */
describe('AT-3 breaksPaid integration with break policy', () => {
  const workDate = d('2026-09-28');
  const shift: ResolvedShift = {
    date: workDate,
    source: 'template',
    shiftId: 'shift-1',
    versionId: 'v-1',
    kind: 'fixed',
    start: '09:00' as LocalTime,
    end: '18:00' as LocalTime,
    isOvernight: false,
    graceMinutes: 10,
    earlyExitGraceMinutes: 0,
    fullDayMinutes: 450,
    halfDayMinutes: 240,
    complementaryHalfMinutes: null,
    minOvertimeMinutes: 30,
    earlyWindowMinutes: 180,
    maxClosingExtensionMinutes: 240,
    timezone: 'Asia/Kolkata',
  };
  const closingCap = new Date('2026-09-28T22:00:00+05:30');
  const eventsWithBreak = [
    punch('in',          '2026-09-28T09:00:00'),
    punch('break-start', '2026-09-28T13:00:00'),
    punch('break-end',   '2026-09-28T13:45:00'),
    punch('out',         '2026-09-28T18:00:00'),
  ];

  const base = {
    workDate,
    shift,
    closingCap,
    closed: true,
    dayType: 'working' as const,
    employed: true,
    events: eventsWithBreak,
    overlays: [],
    nightWindow: null,
    attributionFlags: [],
  };

  it('breaksPaid=true: break minutes do not reduce worked minutes', () => {
    const result = calculate({ ...base, breaksPaid: true });
    // 9:00 to 18:00 = 540 min; break is paid so it counts toward worked minutes
    expect(result.workedMinutes).toBe(540);
    expect(result.breakMinutes).toBe(45);
  });

  it('breaksPaid=false: break minutes reduce worked minutes', () => {
    const result = calculate({ ...base, breaksPaid: false });
    // 540 - 45 break minutes = 495 worked minutes
    expect(result.workedMinutes).toBe(495);
    expect(result.breakMinutes).toBe(45);
  });

  it('policySnapshot null (no policy registered): defaults to breaksPaid=true', () => {
    // Simulates the recalculateRecord path: policySnapshot?.countsTowardWorkHours ?? true
    // Cast needed to avoid TypeScript narrowing away the null union.
    const policySnapshot = null as { countsTowardWorkHours: boolean } | null;
    const breaksPaid = policySnapshot?.countsTowardWorkHours ?? true;
    expect(breaksPaid).toBe(true);
    const result = calculate({ ...base, breaksPaid });
    expect(result.workedMinutes).toBe(540);
  });

  it('policySnapshot with countsTowardWorkHours=true: breaksPaid=true', () => {
    const policySnapshot = {
      policyVersionId: 'pv-1',
      countsTowardWorkHours: true,
      upperTotalMinutes: 60,
      upperSingleMinutes: null,
      lowerTotalMinutes: null,
      lowerEnforced: false,
      graceMinutes: 5,
      warningPercent: 80,
    };
    const breaksPaid = policySnapshot?.countsTowardWorkHours ?? true;
    expect(breaksPaid).toBe(true);
    const result = calculate({ ...base, breaksPaid });
    expect(result.workedMinutes).toBe(540);
  });

  it('policySnapshot with countsTowardWorkHours=false: breaksPaid=false', () => {
    const policySnapshot = {
      policyVersionId: 'pv-2',
      countsTowardWorkHours: false,
      upperTotalMinutes: 60,
      upperSingleMinutes: null,
      lowerTotalMinutes: null,
      lowerEnforced: false,
      graceMinutes: 5,
      warningPercent: 80,
    };
    const breaksPaid = policySnapshot?.countsTowardWorkHours ?? true;
    expect(breaksPaid).toBe(false);
    const result = calculate({ ...base, breaksPaid });
    expect(result.workedMinutes).toBe(495);
  });
});
