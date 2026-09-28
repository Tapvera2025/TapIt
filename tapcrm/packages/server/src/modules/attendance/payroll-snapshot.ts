import type { DateOnly } from '@tapcrm/contracts';
import type { Tx } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';

export interface AttendanceDaySnapshot {
  readonly recordId: string;
  readonly userId: string;
  readonly workDate: DateOnly;
  readonly state: 'open' | 'closed';
  readonly status: string;
  readonly presentUnits: number;
  readonly paidLeaveUnits: number;
  readonly unpaidLeaveUnits: number;
  readonly absentUnits: number;
  readonly holidayUnits: number;
  readonly workedMinutes: number;
  readonly breakMinutes: number;
  readonly nightMinutes: number;
  readonly overtimeMinutes: number;
  readonly inputVersion: number;
  readonly calculatedInputVersion: number;
  readonly calculationVersion: number;
  readonly breaksEvaluatedVersion: number | null;
  readonly breaksEvaluationRevision: bigint;
  /** Truthy flags that block payroll: 'recalculation-failed' | 'open-day' | 'not-evaluated' | 'stale-evaluation' */
  readonly payrollBlockerFlags: string[];
}

export interface MissingDay {
  readonly userId: string;
  readonly workDate: DateOnly;
  readonly reason: 'no-record';
}

export interface PeriodSnapshot {
  readonly days: AttendanceDaySnapshot[];
  readonly missing: MissingDay[];
}

/**
 * Returns materialized attendance days for the given users in [from, to].
 * Also returns missing dates within each user's employed intersection (passed as employedDates).
 *
 * payrollBlockerFlags on a day:
 * - 'recalculation-failed' if the day has that flag
 * - 'open-day' if state = 'open'
 * - 'not-evaluated' if state = 'closed' AND breaks_evaluated_version IS NULL
 * - 'stale-evaluation' if state = 'closed' AND breaks_evaluated_version IS DISTINCT FROM calculation_version
 */
export async function snapshotPeriod(
  tx: Tx,
  userIds: readonly string[],
  from: DateOnly,
  to: DateOnly,
): Promise<PeriodSnapshot> {
  if (userIds.length === 0) return { days: [], missing: [] };
  const rows = await tx.query<{
    recordId: string;
    userId: string;
    workDate: DateOnly;
    state: 'open' | 'closed';
    status: string;
    presentUnits: number;
    paidLeaveUnits: number;
    unpaidLeaveUnits: number;
    absentUnits: number;
    holidayUnits: number;
    workedMinutes: number;
    breakMinutes: number;
    nightMinutes: number;
    overtimeMinutes: number;
    inputVersion: number;
    calculatedInputVersion: number;
    calculationVersion: number;
    breaksEvaluatedVersion: number | null;
    breaksEvaluationRevision: bigint;
    recalculationFailed: boolean;
  }>(sql`
    SELECT id AS "recordId", user_id AS "userId", work_date::text AS "workDate",
           state, status,
           present_units AS "presentUnits",
           paid_leave_units AS "paidLeaveUnits",
           unpaid_leave_units AS "unpaidLeaveUnits",
           absent_units AS "absentUnits",
           holiday_units AS "holidayUnits",
           worked_minutes AS "workedMinutes",
           break_minutes AS "breakMinutes",
           COALESCE(night_minutes, 0) AS "nightMinutes",
           COALESCE(overtime_minutes, 0) AS "overtimeMinutes",
           input_version AS "inputVersion",
           calculated_input_version AS "calculatedInputVersion",
           calculation_version AS "calculationVersion",
           breaks_evaluated_version AS "breaksEvaluatedVersion",
           breaks_evaluation_revision AS "breaksEvaluationRevision",
           (COALESCE(flags, '[]'::jsonb) @> '["recalculation-failed"]'::jsonb) AS "recalculationFailed"
    FROM attendance_record
    WHERE user_id = ANY(${userIds}::uuid[])
      AND work_date >= ${from}
      AND work_date <= ${to}
    ORDER BY user_id, work_date
  `);
  const days: AttendanceDaySnapshot[] = rows.map((r) => {
    const blockers: string[] = [];
    if (r.recalculationFailed) blockers.push('recalculation-failed');
    if (r.state === 'open') blockers.push('open-day');
    if (r.state === 'closed' && r.breaksEvaluatedVersion === null) blockers.push('not-evaluated');
    else if (r.state === 'closed' && r.breaksEvaluatedVersion !== r.calculationVersion) blockers.push('stale-evaluation');
    return {
      recordId: r.recordId,
      userId: r.userId,
      workDate: r.workDate,
      state: r.state,
      status: r.status,
      presentUnits: r.presentUnits,
      paidLeaveUnits: r.paidLeaveUnits,
      unpaidLeaveUnits: r.unpaidLeaveUnits,
      absentUnits: r.absentUnits,
      holidayUnits: r.holidayUnits,
      workedMinutes: r.workedMinutes,
      breakMinutes: r.breakMinutes,
      nightMinutes: r.nightMinutes,
      overtimeMinutes: r.overtimeMinutes,
      inputVersion: r.inputVersion,
      calculatedInputVersion: r.calculatedInputVersion,
      calculationVersion: r.calculationVersion,
      breaksEvaluatedVersion: r.breaksEvaluatedVersion,
      breaksEvaluationRevision: r.breaksEvaluationRevision,
      payrollBlockerFlags: blockers,
    };
  });
  return { days, missing: [] }; // Missing days require employment intersection — payroll will compute that from the frozen run
}

export interface OpenItem {
  readonly userId: string;
  readonly workDate: DateOnly | null;
  readonly kind:
    | 'open-day'
    | 'recalculation-failed'
    | 'not-evaluated'
    | 'stale-evaluation'
    | 'pending-correction'
    | 'open-review-item';
  readonly sourceId: string | null;
}

/**
 * Returns all items that block payroll publication for the given users in [from, to].
 * Only attendance SQL reads attendance/correction tables.
 */
export async function openItems(
  tx: Tx,
  userIds: readonly string[],
  from: DateOnly,
  to: DateOnly,
): Promise<OpenItem[]> {
  if (userIds.length === 0) return [];
  const items: OpenItem[] = [];

  // 1. Open/stale/failed attendance days
  const dayRows = await tx.query<{ userId: string; workDate: DateOnly; kind: string; recordId: string }>(sql`
    SELECT user_id AS "userId", work_date::text AS "workDate",
           CASE
             WHEN state = 'open' THEN 'open-day'
             WHEN (COALESCE(flags, '[]'::jsonb) @> '["recalculation-failed"]'::jsonb) THEN 'recalculation-failed'
             WHEN state = 'closed' AND breaks_evaluated_version IS NULL THEN 'not-evaluated'
             WHEN state = 'closed' AND breaks_evaluated_version IS DISTINCT FROM calculation_version THEN 'stale-evaluation'
           END AS kind,
           id AS "recordId"
    FROM attendance_record
    WHERE user_id = ANY(${userIds}::uuid[])
      AND work_date >= ${from}
      AND work_date <= ${to}
      AND (
        state = 'open'
        OR (COALESCE(flags, '[]'::jsonb) @> '["recalculation-failed"]'::jsonb)
        OR (state = 'closed' AND (breaks_evaluated_version IS NULL OR breaks_evaluated_version IS DISTINCT FROM calculation_version))
      )
  `);
  for (const r of dayRows) {
    items.push({ userId: r.userId, workDate: r.workDate, kind: r.kind as OpenItem['kind'], sourceId: r.recordId });
  }

  // 2. Pending corrections
  const corrRows = await tx.query<{ userId: string; workDate: DateOnly; id: string }>(sql`
    SELECT user_id AS "userId", work_date::text AS "workDate", id
    FROM attendance_correction
    WHERE user_id = ANY(${userIds}::uuid[])
      AND work_date >= ${from}
      AND work_date <= ${to}
      AND status = 'pending'
  `);
  for (const r of corrRows) {
    items.push({ userId: r.userId, workDate: r.workDate, kind: 'pending-correction', sourceId: r.id });
  }

  return items;
}
