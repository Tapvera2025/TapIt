import type { DateOnly } from '@tapcrm/contracts';
import type { Tx } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import { lockPerson } from './repository.js';

/**
 * Break evaluation query helpers (§13, BM design, Task 3).
 *
 * These are the DB side of the evaluation watermark: scanning stale closed
 * records, loading full day data for evaluation, and writing the evaluated
 * watermark back with compare-and-set semantics.
 */

export interface BreakEvaluationCandidate {
  readonly recordId: string;
  readonly userId: string;
  readonly organizationId: string;
  readonly workDate: DateOnly;
  readonly calculationVersion: number;
  readonly breaksEvaluationRevision: bigint;
}

/**
 * Page closed records where breaks_evaluated_version is stale.
 * Uses the ix_attendance_record_break_eval index.
 */
export async function breakEvaluationCandidates(
  tx: Tx,
  organizationId: string,
  afterId: string | null,
  limit: number,
): Promise<BreakEvaluationCandidate[]> {
  return tx.query<BreakEvaluationCandidate>(sql`
    SELECT id AS "recordId", user_id AS "userId", organization_id AS "organizationId",
           work_date::text AS "workDate",
           calculation_version AS "calculationVersion",
           breaks_evaluation_revision AS "breaksEvaluationRevision"
    FROM attendance_record
    WHERE organization_id = ${organizationId}
      AND state = 'closed'
      AND (breaks_evaluated_version IS NULL OR breaks_evaluated_version IS DISTINCT FROM calculation_version)
      AND (${afterId}::uuid IS NULL OR id > ${afterId}::uuid)
    ORDER BY id
    LIMIT ${limit}
  `);
}

/** The earliest stale closed day in the affected ISO week and local month for a person. */
export async function earliestStaleBreakDay(
  tx: Tx,
  organizationId: string,
  userId: string,
  isoWeekStart: DateOnly,
  isoWeekEnd: DateOnly,
  monthStart: DateOnly,
  monthEnd: DateOnly,
): Promise<{ recordId: string; workDate: DateOnly } | null> {
  return tx.maybeOne<{ recordId: string; workDate: DateOnly }>(sql`
    SELECT id AS "recordId", work_date::text AS "workDate"
    FROM attendance_record
    WHERE organization_id = ${organizationId}
      AND user_id = ${userId}
      AND state = 'closed'
      AND (breaks_evaluated_version IS NULL OR breaks_evaluated_version IS DISTINCT FROM calculation_version)
      AND (
        (work_date >= ${isoWeekStart} AND work_date <= ${isoWeekEnd})
        OR (work_date >= ${monthStart} AND work_date <= ${monthEnd})
      )
    ORDER BY work_date ASC
    LIMIT 1
  `);
}

export interface BreakDayRecord {
  readonly recordId: string;
  readonly userId: string;
  readonly organizationId: string;
  readonly workDate: DateOnly;
  readonly state: 'open' | 'closed';
  readonly calculationVersion: number;
  readonly calculatedInputVersion: number;
  readonly breaksEvaluationRevision: bigint;
  readonly breaksEvaluatedVersion: number | null;
  readonly shiftSnapshot: unknown;
  readonly placementSnapshot: unknown;
  readonly breakPolicySnapshot: unknown | null;
  readonly dayType: string;
}

/** Load a day's record with all break-evaluation relevant fields. Takes the person lock. */
export async function loadBreakDay(
  tx: Tx,
  recordId: string,
): Promise<BreakDayRecord | null> {
  return tx.maybeOne<BreakDayRecord>(sql`
    SELECT id AS "recordId", user_id AS "userId", organization_id AS "organizationId",
           work_date::text AS "workDate", state,
           calculation_version AS "calculationVersion",
           calculated_input_version AS "calculatedInputVersion",
           breaks_evaluation_revision AS "breaksEvaluationRevision",
           breaks_evaluated_version AS "breaksEvaluatedVersion",
           shift_snapshot AS "shiftSnapshot",
           placement_snapshot AS "placementSnapshot",
           break_policy_snapshot AS "breakPolicySnapshot",
           day_type AS "dayType"
    FROM attendance_record
    WHERE id = ${recordId}
    FOR UPDATE
  `);
}

/**
 * Compare-and-set the evaluation watermark.
 * Returns true if the update happened, false if the version/revision no longer matches.
 */
export async function setBreaksEvaluatedVersion(
  tx: Tx,
  recordId: string,
  expectedCalculationVersion: number,
  expectedRevision: bigint,
): Promise<boolean> {
  const result = await tx.query<{ id: string }>(sql`
    UPDATE attendance_record
    SET breaks_evaluated_version = ${expectedCalculationVersion}
    WHERE id = ${recordId}
      AND calculation_version = ${expectedCalculationVersion}
      AND breaks_evaluation_revision = ${expectedRevision}
    RETURNING id
  `);
  return result.length > 0;
}

/**
 * Increment breaks_evaluation_revision and clear the watermark for affected days.
 * Called when a correction, leave change or policy input changes an earlier day.
 */
export async function invalidateBreakEvaluations(
  tx: Tx,
  organizationId: string,
  userId: string,
  from: DateOnly,
  to: DateOnly | null,
): Promise<void> {
  await lockPerson(tx, userId);
  await tx.query(sql`
    UPDATE attendance_record
    SET breaks_evaluation_revision = breaks_evaluation_revision + 1,
        breaks_evaluated_version = NULL
    WHERE organization_id = ${organizationId}
      AND user_id = ${userId}
      AND work_date >= ${from}
      AND (${to}::date IS NULL OR work_date <= ${to}::date)
  `);
}
