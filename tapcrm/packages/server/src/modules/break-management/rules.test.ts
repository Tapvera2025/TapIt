/**
 * Unit tests for rules.ts — break measurement and violation detection.
 */
import { describe, it, expect } from 'vitest';
import type { DayReading } from '@tapcrm/contracts';
import type { BreakPolicySnapshot } from '../attendance/facade.js';
import {
  measureBreaks,
  checkViolations,
  warningThreshold,
  checkWarningState,
  selectRule,
  type BreakMeasurement,
  type CandidateRule,
} from './rules.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function reading(
  breaks: { from: string; to: string | null }[],
  departureAt?: string,
): DayReading {
  return {
    state: departureAt ? 'FINISHED' : 'WORKING',
    arrival: {
      at: '2026-06-01T09:00:00.000Z',
      kind: 'in',
      evidence: 'confirmed',
      eventIds: ['e-in'],
    },
    departure: departureAt
      ? { at: departureAt, kind: 'out', evidence: 'confirmed', eventIds: ['e-out'] }
      : null,
    breaks,
    notApplied: new Map(),
  };
}

function policy(overrides: Partial<BreakPolicySnapshot> = {}): BreakPolicySnapshot {
  return {
    policyVersionId:       'v1',
    countsTowardWorkHours: false,
    upperTotalMinutes:     60,
    upperSingleMinutes:    30,
    lowerTotalMinutes:     20,
    lowerEnforced:         true,
    graceMinutes:          5,
    warningPercent:        80,
    ...overrides,
  };
}

function rule(
  overrides: Partial<CandidateRule> & { ruleId: string; condition: CandidateRule['condition'] },
): CandidateRule {
  return {
    ordinal:          1,
    occurrenceWindow: 'day',
    occurrenceCount:  1,
    consequence:      'warn',
    minutes:          null,
    amount:           null,
    autoApply:        false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// measureBreaks
// ---------------------------------------------------------------------------

describe('measureBreaks', () => {
  it('returns zeros when there are no breaks', () => {
    expect(measureBreaks(reading([]))).toEqual({ totalMinutes: 0, longestMinutes: 0, count: 0 });
  });

  it('measures a single closed break', () => {
    const r = reading([
      { from: '2026-06-01T12:00:00.000Z', to: '2026-06-01T12:30:00.000Z' },
    ]);
    expect(measureBreaks(r)).toEqual({ totalMinutes: 30, longestMinutes: 30, count: 1 });
  });

  it('sums two breaks and tracks longest separately', () => {
    const r = reading([
      { from: '2026-06-01T10:00:00.000Z', to: '2026-06-01T10:15:00.000Z' }, // 15 min
      { from: '2026-06-01T12:00:00.000Z', to: '2026-06-01T12:45:00.000Z' }, // 45 min
    ]);
    expect(measureBreaks(r)).toEqual({ totalMinutes: 60, longestMinutes: 45, count: 2 });
  });

  it('skips a zero-duration break (same instant)', () => {
    const r = reading([
      { from: '2026-06-01T12:00:00.000Z', to: '2026-06-01T12:00:00.000Z' },
    ]);
    expect(measureBreaks(r)).toEqual({ totalMinutes: 0, longestMinutes: 0, count: 0 });
  });

  it('closes an open break with the departure time', () => {
    // Open break, departure exists → use departure
    const r = reading(
      [{ from: '2026-06-01T12:00:00.000Z', to: null }],
      '2026-06-01T12:40:00.000Z',
    );
    expect(measureBreaks(r)).toEqual({ totalMinutes: 40, longestMinutes: 40, count: 1 });
  });

  it('closes an open break with the closing cap when no departure', () => {
    const r = reading([{ from: '2026-06-01T12:00:00.000Z', to: null }]);
    const capMs = Date.parse('2026-06-01T12:20:00.000Z');
    expect(measureBreaks(r, capMs)).toEqual({ totalMinutes: 20, longestMinutes: 20, count: 1 });
  });

  it('skips an open break when there is no departure and no closing cap', () => {
    const r = reading([{ from: '2026-06-01T12:00:00.000Z', to: null }]);
    expect(measureBreaks(r)).toEqual({ totalMinutes: 0, longestMinutes: 0, count: 0 });
  });

  it('floors sub-minute durations', () => {
    // 90.5 seconds total → 1 minute (floored)
    const r = reading([
      { from: '2026-06-01T12:00:00.000Z', to: '2026-06-01T12:01:30.500Z' },
    ]);
    expect(measureBreaks(r).totalMinutes).toBe(1);
    expect(measureBreaks(r).longestMinutes).toBe(1);
  });

  it('handles overnight breaks correctly via ISO instants', () => {
    // Break starts at 23:30 one day, ends at 00:10 the next (40 min)
    const r = reading([
      { from: '2026-06-01T23:30:00.000Z', to: '2026-06-02T00:10:00.000Z' },
    ]);
    expect(measureBreaks(r)).toEqual({ totalMinutes: 40, longestMinutes: 40, count: 1 });
  });

  it('departure takes precedence over closingCap for open break', () => {
    const r = reading(
      [{ from: '2026-06-01T12:00:00.000Z', to: null }],
      '2026-06-01T12:30:00.000Z', // departure = 30 min
    );
    const capMs = Date.parse('2026-06-01T13:00:00.000Z'); // cap = 60 min
    expect(measureBreaks(r, capMs)).toEqual({ totalMinutes: 30, longestMinutes: 30, count: 1 });
  });
});

// ---------------------------------------------------------------------------
// checkViolations
// ---------------------------------------------------------------------------

describe('checkViolations', () => {
  it('returns empty array for a clean day', () => {
    const m: BreakMeasurement = { totalMinutes: 30, longestMinutes: 20, count: 1 };
    expect(checkViolations(m, policy(), false)).toHaveLength(0);
  });

  it('detects over-total: measured > limit + grace', () => {
    // limit=60, grace=5 → breach when > 65
    const m: BreakMeasurement = { totalMinutes: 66, longestMinutes: 20, count: 1 };
    const v = checkViolations(m, policy(), false);
    expect(v).toHaveLength(1);
    expect(v[0]!.kind).toBe('over-total');
    expect(v[0]!.measured).toBe(66);
    expect(v[0]!.limit).toBe(60);
    expect(v[0]!.grace).toBe(5);
  });

  it('does NOT detect over-total when exactly at limit + grace', () => {
    const m: BreakMeasurement = { totalMinutes: 65, longestMinutes: 20, count: 1 };
    const v = checkViolations(m, policy(), false);
    expect(v.filter((x) => x.kind === 'over-total')).toHaveLength(0);
  });

  it('detects over-single: longestMinutes > limit + grace', () => {
    // upperSingle=30, grace=5 → breach when > 35
    const m: BreakMeasurement = { totalMinutes: 40, longestMinutes: 36, count: 2 };
    const v = checkViolations(m, policy(), false);
    expect(v.some((x) => x.kind === 'over-single')).toBe(true);
  });

  it('detects under-total: measured < limit - grace', () => {
    // lowerTotal=20, grace=5 → breach when < 15
    const m: BreakMeasurement = { totalMinutes: 14, longestMinutes: 14, count: 1 };
    const v = checkViolations(m, policy(), false);
    expect(v.some((x) => x.kind === 'under-total')).toBe(true);
  });

  it('does NOT detect under-total when exactly at limit - grace', () => {
    const m: BreakMeasurement = { totalMinutes: 15, longestMinutes: 15, count: 1 };
    const v = checkViolations(m, policy(), false);
    expect(v.filter((x) => x.kind === 'under-total')).toHaveLength(0);
  });

  it('does NOT detect over-single on flexible day (BM-15)', () => {
    const m: BreakMeasurement = { totalMinutes: 50, longestMinutes: 36, count: 2 };
    const v = checkViolations(m, policy(), true /* isFlexible */);
    expect(v.filter((x) => x.kind === 'over-single')).toHaveLength(0);
  });

  it('does NOT detect under-total on flexible day (BM-15)', () => {
    const m: BreakMeasurement = { totalMinutes: 5, longestMinutes: 5, count: 1 };
    const v = checkViolations(m, policy(), true /* isFlexible */);
    expect(v.filter((x) => x.kind === 'under-total')).toHaveLength(0);
  });

  it('still detects over-total on flexible day', () => {
    const m: BreakMeasurement = { totalMinutes: 90, longestMinutes: 50, count: 2 };
    const v = checkViolations(m, policy(), true /* isFlexible */);
    expect(v.some((x) => x.kind === 'over-total')).toBe(true);
  });

  it('skips over-total check when policy has no upper total limit', () => {
    const m: BreakMeasurement = { totalMinutes: 999, longestMinutes: 10, count: 1 };
    const p = policy({ upperTotalMinutes: null });
    const v = checkViolations(m, p, false);
    expect(v.filter((x) => x.kind === 'over-total')).toHaveLength(0);
  });

  it('can return multiple violations simultaneously', () => {
    // Both over-total and over-single at once
    const m: BreakMeasurement = { totalMinutes: 90, longestMinutes: 40, count: 2 };
    const v = checkViolations(m, policy(), false);
    const kinds = v.map((x) => x.kind);
    expect(kinds).toContain('over-total');
    expect(kinds).toContain('over-single');
  });
});

// ---------------------------------------------------------------------------
// warningThreshold
// ---------------------------------------------------------------------------

describe('warningThreshold', () => {
  it('calculates the correct threshold', () => {
    // (60 + 5) * 80 / 100 = 52, ceil = 52
    expect(warningThreshold(60, 5, 80)).toBe(52);
  });

  it('uses ceil for fractional results', () => {
    // (30 + 3) * 75 / 100 = 24.75 → 25
    expect(warningThreshold(30, 3, 75)).toBe(25);
  });

  it('handles 100% warning (warn at the breach point)', () => {
    expect(warningThreshold(60, 5, 100)).toBe(65);
  });
});

// ---------------------------------------------------------------------------
// checkWarningState
// ---------------------------------------------------------------------------

describe('checkWarningState', () => {
  // limit=60, grace=5 → breach > 65; threshold = ceil(65*80/100) = 52
  it('returns clear below warning threshold', () => {
    expect(checkWarningState(40, 60, 5, 80)).toBe('clear');
  });

  it('returns warning at the warning threshold', () => {
    expect(checkWarningState(52, 60, 5, 80)).toBe('warning');
  });

  it('returns warning between threshold and breach boundary', () => {
    expect(checkWarningState(65, 60, 5, 80)).toBe('warning');
  });

  it('returns breach above limit + grace', () => {
    expect(checkWarningState(66, 60, 5, 80)).toBe('breach');
  });
});

// ---------------------------------------------------------------------------
// selectRule
// ---------------------------------------------------------------------------

describe('selectRule', () => {
  it('returns null when there are no violations', () => {
    const rules = [rule({ ruleId: 'r1', condition: 'over-total' })];
    expect(selectRule([], rules, true)).toBeNull();
  });

  it('returns null when violations do not match any rule', () => {
    const rules = [rule({ ruleId: 'r1', condition: 'over-single' })];
    const violations = [
      { violated: true as const, kind: 'over-total' as const, measured: 70, limit: 60, grace: 5 },
    ];
    expect(selectRule(violations, rules, true)).toBeNull();
  });

  it('returns the matching rule', () => {
    const rules = [rule({ ruleId: 'r1', condition: 'over-total', ordinal: 1 })];
    const violations = [
      { violated: true as const, kind: 'over-total' as const, measured: 70, limit: 60, grace: 5 },
    ];
    expect(selectRule(violations, rules, true)!.ruleId).toBe('r1');
  });

  it('returns the first matching rule by ascending ordinal', () => {
    const rules = [
      rule({ ruleId: 'r3', condition: 'over-total', ordinal: 3 }),
      rule({ ruleId: 'r1', condition: 'over-total', ordinal: 1 }),
      rule({ ruleId: 'r2', condition: 'over-total', ordinal: 2 }),
    ];
    const violations = [
      { violated: true as const, kind: 'over-total' as const, measured: 70, limit: 60, grace: 5 },
    ];
    expect(selectRule(violations, rules, true)!.ruleId).toBe('r1');
  });

  it('skips under-total rules when lowerEnforced=false (advisory only)', () => {
    const rules = [
      rule({ ruleId: 'r1', condition: 'under-total', ordinal: 1 }),
      rule({ ruleId: 'r2', condition: 'over-total', ordinal: 2 }),
    ];
    const violations = [
      { violated: true as const, kind: 'under-total' as const, measured: 10, limit: 20, grace: 5 },
      { violated: true as const, kind: 'over-total' as const, measured: 70, limit: 60, grace: 5 },
    ];
    // lowerEnforced=false → skip under-total rule, pick over-total at ordinal 2
    expect(selectRule(violations, rules, false)!.ruleId).toBe('r2');
  });

  it('applies under-total rules when lowerEnforced=true', () => {
    const rules = [
      rule({ ruleId: 'r1', condition: 'under-total', ordinal: 1 }),
    ];
    const violations = [
      { violated: true as const, kind: 'under-total' as const, measured: 10, limit: 20, grace: 5 },
    ];
    expect(selectRule(violations, rules, true)!.ruleId).toBe('r1');
  });
});
