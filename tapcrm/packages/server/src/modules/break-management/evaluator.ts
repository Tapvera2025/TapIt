import { createHash } from 'node:crypto';
import { readDay } from '@tapcrm/contracts';
import type { DateOnly } from '@tapcrm/contracts';
import type { Tx } from '../../platform/dal/db.js';
import { addDays, weekdayOf } from '../../platform/time.js';
import * as AttFacade from '../attendance/facade.js';
import { measureBreaks, checkViolations, selectRule } from './rules.js';
import {
  loadAssignmentsForSubject,
  loadVersionsForPolicies,
  loadRulesForVersion,
  currentBreachAnswer,
  countOccurrences,
  insertBreach,
  supersedeBreach,
} from './repository.js';
import { resolveBreakPolicy } from './resolver.js';
import type { CandidateRule } from './rules.js';

export type EvalOutcome = 'evaluated' | 'no-op' | 'stale-payload' | 'blocked-by-earlier';

// ---------------------------------------------------------------------------
// Pure fingerprint helpers (exported for testing)
// ---------------------------------------------------------------------------

/**
 * SHA-256 of sorted event IDs + break intervals (from-to strings).
 * Deterministic: events are sorted by id before hashing.
 */
export function computeEvidenceFingerprint(
  eventIds: readonly string[],
  breaks: readonly { from: string; to: string | null }[],
): string {
  const sorted = [...eventIds].sort();
  const breakParts = breaks.map((b) => [b.from, b.to ?? 'open'].join('/'));
  const payload = JSON.stringify({ events: sorted, breaks: breakParts });
  return createHash('sha256').update(payload).digest('hex');
}

/**
 * SHA-256 of evidence fingerprint + policy version ID + day type + suppression reason +
 * rule ID + occurrence number.
 */
export function computeAnswerFingerprint(
  evidenceFingerprint: string,
  policyVersionId: string | null,
  dayType: string,
  suppressionReason: string | null,
  ruleId: string | null,
  occurrenceNumber: number | null,
): string {
  const payload = JSON.stringify({
    evidence: evidenceFingerprint,
    policyVersionId: policyVersionId ?? 'null',
    dayType,
    suppressionReason: suppressionReason ?? 'none',
    ruleId: ruleId ?? 'none',
    occurrenceNumber: occurrenceNumber ?? 0,
  });
  return createHash('sha256').update(payload).digest('hex');
}

// ---------------------------------------------------------------------------
// Window helpers (exported for testing)
// ---------------------------------------------------------------------------

/**
 * ISO week bounds (Mon–Sun) for a given ISO date string.
 * Returns { isoWeekStart, isoWeekEnd } as DateOnly strings.
 *
 * Uses platform/time.ts weekdayOf (1=Mon … 7=Sun) and addDays to stay
 * timezone-safe (T-2).
 */
export function isoWeekBounds(workDate: DateOnly): { isoWeekStart: DateOnly; isoWeekEnd: DateOnly } {
  // weekdayOf: 1=Mon, 7=Sun
  const wd = weekdayOf(workDate);
  const daysFromMon = wd - 1; // 0 for Monday, 6 for Sunday
  const isoWeekStart = addDays(workDate, -daysFromMon);
  const isoWeekEnd = addDays(isoWeekStart, 6);
  return { isoWeekStart, isoWeekEnd };
}

/**
 * Calendar month bounds for a given ISO date string.
 * Returns { monthStart, monthEnd } as DateOnly strings.
 *
 * Pure string arithmetic on YYYY-MM-DD — no Date constructor involved (T-2).
 */
export function monthBounds(workDate: DateOnly): { monthStart: DateOnly; monthEnd: DateOnly } {
  const year = Number(workDate.slice(0, 4));
  const month = Number(workDate.slice(5, 7));
  const monthStart = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-01` as DateOnly;
  // Advance to first day of next month, then subtract one day to get last day of this month
  const nextMonthYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const firstOfNext = `${String(nextMonthYear).padStart(4, '0')}-${String(nextMonth).padStart(2, '0')}-01` as DateOnly;
  const monthEnd = addDays(firstOfNext, -1);
  return { monthStart, monthEnd };
}

// ---------------------------------------------------------------------------
// Occurrence window helper
// ---------------------------------------------------------------------------

function occurrenceWindowBounds(
  window: 'day' | 'week' | 'month',
  workDate: DateOnly,
): { windowStart: DateOnly; windowEnd: DateOnly } {
  if (window === 'day') {
    return { windowStart: workDate, windowEnd: workDate };
  }
  if (window === 'week') {
    const { isoWeekStart, isoWeekEnd } = isoWeekBounds(workDate);
    return { windowStart: isoWeekStart, windowEnd: isoWeekEnd };
  }
  // month
  const { monthStart, monthEnd } = monthBounds(workDate);
  return { windowStart: monthStart, windowEnd: monthEnd };
}

// ---------------------------------------------------------------------------
// Core evaluator
// ---------------------------------------------------------------------------

export async function evaluateBreakDay(
  tx: Tx,
  recordId: string,
  expectedCalculationVersion: number,
  expectedRevision: bigint,
  clock: { now(): Date },
): Promise<EvalOutcome> {
  // 1. Load and recheck the record (under person lock already held by caller)
  const record = await AttFacade.loadBreakDay(tx, recordId);
  if (record === null) return 'stale-payload';
  if (record.state !== 'closed') return 'stale-payload';
  if (record.calculationVersion !== expectedCalculationVersion) return 'stale-payload';
  if (BigInt(record.breaksEvaluationRevision) !== expectedRevision) return 'stale-payload';

  // Already up to date: watermark matches and revision is 0 (never dirtied after eval)
  if (
    record.calculationVersion === (record.breaksEvaluatedVersion ?? -1) &&
    BigInt(record.breaksEvaluationRevision) === 0n
  ) {
    return 'no-op';
  }

  const workDate = record.workDate;

  // 2. Check for blocking earlier stale day in the same ISO week / local month
  const { isoWeekStart, isoWeekEnd } = isoWeekBounds(workDate);
  const { monthStart, monthEnd } = monthBounds(workDate);

  const earliest = await AttFacade.earliestStaleBreakDay(
    tx,
    record.organizationId,
    record.userId,
    isoWeekStart,
    isoWeekEnd,
    monthStart,
    monthEnd,
  );

  if (earliest !== null && earliest.recordId !== recordId && earliest.workDate < workDate) {
    // An earlier stale day must be evaluated first. Throw so the job runner retries.
    throw new Error(`blocked-by-earlier: ${earliest.workDate} must be evaluated before ${workDate}`);
  }

  // 3. Load the day snapshot (events + overlays)
  const snapshot = await AttFacade.loadDaySnapshot(tx, record.userId, workDate);

  // If no snapshot, treat as clean (no events to measure)
  const events = snapshot?.events ?? [];

  // 4. Run readDay to get break intervals
  const reading = readDay(events, null);

  // 5. Compute evidence fingerprint
  // Collect all event IDs from the day's events
  const allEventIds = events.map((e) => e.id);
  const evidenceFingerprint = computeEvidenceFingerprint(allEventIds, reading.breaks);

  // 6. Check leave/holiday suppression
  type SuppressionReason = 'leave' | 'holiday' | null;
  let suppressionReason: SuppressionReason = null;

  if (record.dayType === 'holiday') {
    suppressionReason = 'holiday';
  } else {
    // Check overlays for leave
    const overlays = snapshot?.overlays ?? [];
    const leaveOverlay = overlays.find((o) =>
      o.kind === 'leave-full' || o.kind === 'leave-first-half' || o.kind === 'leave-second-half',
    );
    if (leaveOverlay !== undefined) {
      suppressionReason = 'leave';
    }
  }

  // 7. Resolve break policy
  const placement = record.placementSnapshot as {
    departmentId?: string | null;
    positionId?: string | null;
    teamId?: string | null;
  } | null;
  const shift = record.shiftSnapshot as { shiftId?: string | null } | null;

  const subject = {
    userId: record.userId,
    departmentId: placement?.departmentId ?? null,
    positionId: placement?.positionId ?? null,
    teamId: placement?.teamId ?? null,
    shiftId: shift?.shiftId ?? null,
  };

  const assignments = await loadAssignmentsForSubject(
    tx,
    record.organizationId,
    subject,
    workDate,
  );
  const policyIds = [...new Set(assignments.map((a) => a.policyId))];
  const versions = await loadVersionsForPolicies(
    tx,
    record.organizationId,
    policyIds,
    workDate,
  );
  const policy = resolveBreakPolicy(workDate, subject, assignments, versions);

  // 7a. No policy → clean day (no limits apply)
  if (policy === null) {
    const fingerprint = computeAnswerFingerprint(evidenceFingerprint, null, record.dayType, null, null, null);

    // Handle no-policy clean day: supersede old answer if exists, advance watermark
    const existing = await currentBreachAnswer(tx, record.organizationId, recordId);
    if (existing !== null && existing.answerFingerprint !== fingerprint) {
      await supersedeBreach(tx, existing.id);
      // No new breach needed for a clean day — just advance watermark
    }
    // Advance watermark
    const advanced = await AttFacade.setBreaksEvaluatedVersion(
      tx,
      recordId,
      expectedCalculationVersion,
      expectedRevision,
    );
    if (!advanced) throw new Error('stale-payload: record changed during evaluation');
    return 'evaluated';
  }

  // 8. Load penalty rules for the resolved version
  const rules = await loadRulesForVersion(tx, record.organizationId, policy.policyVersionId);

  // 9. Measure breaks
  const measurement = measureBreaks(reading);

  // 10. Determine isFlexible: flexible if dayType is 'week-off' or shift has no fixed schedule
  // A shift with no hours (or week-off day) is considered flexible (BM-15)
  const shiftSnap = record.shiftSnapshot as { schedule?: { kind?: string } } | null;
  const isFlexible =
    record.dayType === 'week-off' ||
    shiftSnap?.schedule?.kind === 'flexible' ||
    shiftSnap === null;

  // 11. Check violations
  const violations = checkViolations(measurement, policy, isFlexible);

  // 12. Determine status and matched rule
  let selectedRule: CandidateRule | null = null;
  let finalStatus: 'pending' | 'advisory' | 'suppressed';
  let occurrenceNumber: number | null = null;

  if (suppressionReason !== null) {
    // Suppressed by leave or holiday
    finalStatus = 'suppressed';
    selectedRule = null;
  } else {
    // Try to select a rule
    const candidate = selectRule(violations, rules, policy.lowerEnforced);

    if (candidate === null) {
      // No violation or advisory lower-limit only
      if (
        violations.some((v) => v.kind === 'under-total') &&
        !policy.lowerEnforced
      ) {
        // Advisory lower-limit breach
        finalStatus = 'advisory';
      } else {
        // Clean day
        finalStatus = 'advisory'; // use advisory as a "no issue found" marker when no rule matches
        // Actually for a clean day (no violations), we produce no breach
        // Handle clean day
        const cleanFingerprint = computeAnswerFingerprint(
          evidenceFingerprint,
          policy.policyVersionId,
          record.dayType,
          null,
          null,
          null,
        );
        const existing = await currentBreachAnswer(tx, record.organizationId, recordId);
        if (existing !== null && existing.answerFingerprint !== cleanFingerprint) {
          await supersedeBreach(tx, existing.id);
        }
        const advanced = await AttFacade.setBreaksEvaluatedVersion(
          tx,
          recordId,
          expectedCalculationVersion,
          expectedRevision,
        );
        if (!advanced) throw new Error('stale-payload: record changed during evaluation');
        return 'evaluated';
      }
    } else {
      selectedRule = candidate;

      // Count existing occurrences in the rule's window to determine this one's number
      const { windowStart, windowEnd } = occurrenceWindowBounds(
        candidate.occurrenceWindow,
        workDate,
      );
      const existingCount = await countOccurrences(
        tx,
        record.organizationId,
        record.userId,
        candidate.ruleId,
        windowStart,
        windowEnd,
        recordId,
      );
      occurrenceNumber = existingCount + 1;

      // Check if this occurrence meets the rule's threshold
      if (occurrenceNumber < candidate.occurrenceCount) {
        // Advisory: occurrence not yet reached
        finalStatus = 'advisory';
        selectedRule = null;
        occurrenceNumber = null;
      } else {
        finalStatus = 'pending';
      }
    }
  }

  // 13. Compute answer fingerprint
  const answerFingerprint = computeAnswerFingerprint(
    evidenceFingerprint,
    policy.policyVersionId,
    record.dayType,
    suppressionReason,
    selectedRule?.ruleId ?? null,
    occurrenceNumber,
  );

  // 14. Look for current answer for this record
  const existing = await currentBreachAnswer(tx, record.organizationId, recordId);

  if (existing !== null && existing.answerFingerprint === answerFingerprint) {
    // Same answer fingerprint — retain current decision, just advance watermark
    const advanced = await AttFacade.setBreaksEvaluatedVersion(
      tx,
      recordId,
      expectedCalculationVersion,
      expectedRevision,
    );
    if (!advanced) throw new Error('stale-payload: record changed during evaluation');
    return 'evaluated';
  }

  // 15. Supersede old answer if exists
  if (existing !== null) {
    await supersedeBreach(tx, existing.id);
  }

  // 16. Determine auto-apply for confirmed status
  const shouldAutoApply =
    finalStatus === 'pending' &&
    selectedRule !== null &&
    selectedRule.autoApply;

  const insertStatus: 'pending' | 'confirmed' | 'advisory' | 'suppressed' = shouldAutoApply
    ? 'confirmed'
    : finalStatus;

  // 17. Insert new breach row
  const breachId = await insertBreach(tx, {
    organizationId: record.organizationId,
    userId: record.userId,
    attendanceRecordId: recordId,
    workDate,
    policyVersionId: policy.policyVersionId,
    matchedRuleId: selectedRule?.ruleId ?? null,
    occurrenceNumber,
    measuredTotalMinutes: measurement.totalMinutes,
    measuredSingleMinutes: measurement.longestMinutes,
    measuredCount: measurement.count,
    evidenceFingerprint,
    answerFingerprint,
    calculationVersion: record.calculationVersion,
    status: insertStatus,
    suppressionReason,
    autoApplied: shouldAutoApply,
    confirmedAt: shouldAutoApply ? clock.now() : null,
  });

  // 18. For auto-applied overlay consequences (mark-late, mark-half-day, mark-absent, deduct-minutes)
  // apply the attendance overlay. For deduct-amount, confirm the breach but skip payroll writer (Task 6).
  if (shouldAutoApply && selectedRule !== null) {
    const consequence = selectedRule.consequence;
    if (
      consequence === 'mark-late' ||
      consequence === 'mark-half-day' ||
      consequence === 'mark-absent' ||
      consequence === 'deduct-minutes'
    ) {
      await AttFacade.applyOverlay(
        tx,
        {
          sourceKind: 'break-breach',
          sourceId: breachId,
          userId: record.userId,
          workDate,
          kind: 'breach-consequence',
          consequence: consequence,
          minutes: consequence === 'deduct-minutes' ? (selectedRule.minutes ?? null) : null,
        },
        clock,
      );
    }
    // deduct-amount: breach is confirmed with auto_applied=true; payroll writer wired in Task 6
  }

  // 19. Advance watermark (compare-and-set)
  const advanced = await AttFacade.setBreaksEvaluatedVersion(
    tx,
    recordId,
    expectedCalculationVersion,
    expectedRevision,
  );
  if (!advanced) throw new Error('stale-payload: record changed during evaluation');

  return 'evaluated';
}
