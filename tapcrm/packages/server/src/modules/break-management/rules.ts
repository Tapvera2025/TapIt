/**
 * Pure break measurement and violation/warning detection (§13 BM design, Task 2).
 *
 * No DB calls, no side effects. Functions here are the single source of truth
 * for "how many minutes did this person take in breaks" and "does that violate
 * their policy".
 */

import type { DayReading } from '@tapcrm/contracts';
import type { BreakPolicySnapshot } from '../attendance/facade.js';

// ---------------------------------------------------------------------------
// Measurement
// ---------------------------------------------------------------------------

export interface BreakMeasurement {
  /** Floor of total break time in minutes. */
  readonly totalMinutes: number;
  /** Floor of the longest single break in minutes. */
  readonly longestMinutes: number;
  /** Number of counted breaks (zero-duration breaks are excluded). */
  readonly count: number;
}

/**
 * Measure effective breaks from a DayReading.
 *
 * Rules:
 * - A break whose start equals its end (same millisecond) has zero duration and
 *   is NOT counted.
 * - An open break (to === null) is closed by the departure instant when present;
 *   otherwise by `closingCapMs` when provided; otherwise it is skipped entirely.
 * - Durations are computed in milliseconds and floored to whole minutes before
 *   being returned, so any residual seconds are discarded, not rounded.
 * - Overnight breaks are handled correctly because `at` strings are ISO 8601
 *   instants, not local clock strings.
 */
export function measureBreaks(
  reading: DayReading,
  closingCapMs?: number,
): BreakMeasurement {
  const departureMs =
    reading.departure !== null ? Date.parse(reading.departure.at) : null;

  let totalMs = 0;
  let longestMs = 0;
  let count = 0;

  for (const b of reading.breaks) {
    const fromMs = Date.parse(b.from);
    let toMs: number;

    if (b.to !== null) {
      toMs = Date.parse(b.to);
    } else if (departureMs !== null) {
      toMs = departureMs;
    } else if (closingCapMs !== undefined) {
      toMs = closingCapMs;
    } else {
      continue; // open break with no cap — skip
    }

    const durMs = Math.max(0, toMs - fromMs);
    if (durMs === 0) continue; // same-instant break — skip, do not count

    totalMs += durMs;
    if (durMs > longestMs) longestMs = durMs;
    count++;
  }

  return {
    totalMinutes:   Math.floor(totalMs   / 60_000),
    longestMinutes: Math.floor(longestMs / 60_000),
    count,
  };
}

// ---------------------------------------------------------------------------
// Violation detection
// ---------------------------------------------------------------------------

export type ViolationKind = 'over-total' | 'over-single' | 'under-total';

export interface ViolationResult {
  readonly violated: true;
  readonly kind: ViolationKind;
  /** The measured value (minutes). */
  readonly measured: number;
  /** The policy limit (minutes), before grace. */
  readonly limit: number;
  /** Grace that was applied. */
  readonly grace: number;
}

/**
 * Return all violations for a measurement against a policy snapshot.
 *
 * Grace application:
 *   Upper bound: breach when measured > limit + grace
 *   Lower bound: breach when measured < limit - grace
 *
 * Flexible/no-shift days (BM-15):
 *   - over-total still applies (total usage is always enforceable).
 *   - over-single does NOT apply (no fixed single-break cap on flexible days).
 *   - under-total does NOT apply (flexible schedules cannot generate lateness-style consequence).
 */
export function checkViolations(
  measurement: BreakMeasurement,
  policy: BreakPolicySnapshot,
  isFlexible: boolean,
): ViolationResult[] {
  const violations: ViolationResult[] = [];

  // Total upper limit — applies on all day types.
  if (policy.upperTotalMinutes !== null) {
    const threshold = policy.upperTotalMinutes + policy.graceMinutes;
    if (measurement.totalMinutes > threshold) {
      violations.push({
        violated:  true,
        kind:      'over-total',
        measured:  measurement.totalMinutes,
        limit:     policy.upperTotalMinutes,
        grace:     policy.graceMinutes,
      });
    }
  }

  // Single break upper limit — not for flexible days (BM-15).
  if (!isFlexible && policy.upperSingleMinutes !== null) {
    const threshold = policy.upperSingleMinutes + policy.graceMinutes;
    if (measurement.longestMinutes > threshold) {
      violations.push({
        violated:  true,
        kind:      'over-single',
        measured:  measurement.longestMinutes,
        limit:     policy.upperSingleMinutes,
        grace:     policy.graceMinutes,
      });
    }
  }

  // Lower total limit — not for flexible days (BM-15).
  if (!isFlexible && policy.lowerTotalMinutes !== null) {
    const threshold = policy.lowerTotalMinutes - policy.graceMinutes;
    if (measurement.totalMinutes < threshold) {
      violations.push({
        violated:  true,
        kind:      'under-total',
        measured:  measurement.totalMinutes,
        limit:     policy.lowerTotalMinutes,
        grace:     policy.graceMinutes,
      });
    }
  }

  return violations;
}

// ---------------------------------------------------------------------------
// Warning threshold
// ---------------------------------------------------------------------------

/**
 * The warning threshold for an upper limit:
 *   ceil((limit + grace) * warningPercent / 100)
 *
 * Rationale: warn when the person has reached at least this many minutes, so
 * they know they are approaching the breach threshold.
 */
export function warningThreshold(
  limitMinutes: number,
  graceMinutes: number,
  warningPercent: number,
): number {
  const breachThreshold = limitMinutes + graceMinutes;
  return Math.ceil((breachThreshold * warningPercent) / 100);
}

export type WarningState = 'clear' | 'warning' | 'breach';

/**
 * Classify the current measured value as clear / warning / breach.
 *
 *   breach  : measured > limit + grace
 *   warning : measured >= warningThreshold  (and <= breach threshold)
 *   clear   : measured < warningThreshold
 */
export function checkWarningState(
  measured: number,
  limitMinutes: number,
  graceMinutes: number,
  warningPercent: number,
): WarningState {
  const breachThreshold = limitMinutes + graceMinutes;
  if (measured > breachThreshold) return 'breach';
  const warnThreshold = Math.ceil((breachThreshold * warningPercent) / 100);
  if (measured >= warnThreshold) return 'warning';
  return 'clear';
}

// ---------------------------------------------------------------------------
// Rule selection
// ---------------------------------------------------------------------------

export interface CandidateRule {
  readonly ruleId: string;
  readonly ordinal: number;
  readonly condition: 'over-total' | 'over-single' | 'under-total' | 'count-over';
  readonly occurrenceWindow: 'day' | 'week' | 'month';
  readonly occurrenceCount: number;
  readonly consequence: string;
  /** Minutes for deduct-minutes consequence; null otherwise. */
  readonly minutes: number | null;
  /** Amount for deduct-amount consequence; null otherwise. */
  readonly amount: unknown;
  readonly autoApply: boolean;
}

/**
 * Select the first matching rule (ascending ordinal) for the given violation set.
 *
 * Returns null when no rule matches (clean day, or advisory-only lower limit).
 *
 * For `under-total`: only triggers if the policy has `lowerEnforced = true`.
 * Advisory lower-limit findings (lowerEnforced = false) never enter the rule
 * sequence — this prevents spurious consequences on informational-only policies.
 *
 * `count-over` rules require the caller to check occurrence windows externally;
 * this function selects the rule by condition match only — occurrence eligibility
 * is evaluated by the evaluator (Task 5).
 */
export function selectRule(
  violations: readonly ViolationResult[],
  rules: readonly CandidateRule[],
  policyLowerEnforced: boolean,
): CandidateRule | null {
  const violatedKinds = new Set(violations.map((v) => v.kind));

  const sorted = [...rules].sort((a, b) => a.ordinal - b.ordinal);
  for (const rule of sorted) {
    if (rule.condition === 'under-total' && !policyLowerEnforced) continue;
    if (violatedKinds.has(rule.condition as ViolationKind)) return rule;
  }
  return null;
}
