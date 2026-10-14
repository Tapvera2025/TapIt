import type { SqlFragment } from '@tapcrm/authz';
import type { DateOnly } from '@tapcrm/contracts';
import type { RequestContext } from '../../platform/dal/context.js';
import type { Tx } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import { ATTENDANCE_EVENTS } from './events.js';

/**
 * SQL for the read API and the export (§8.7). Every list joins `app_user u`,
 * because the `attendanceRecord` policy filters on the person (`u.…`), as
 * `userPolicy` does.
 */

/** One stored day, as the list and the export read it. */
export interface RecordListRow {
  userId: string;
  employeeId: string | null;
  workDate: DateOnly;
  state: 'open' | 'closed';
  status: string | null;
  dayType: string;
  presentUnits: number;
  paidLeaveUnits: number; // a half-day count, not money (CI-21)
  unpaidLeaveUnits: number;
  absentUnits: number;
  holidayUnits: number;
  workedMinutes: number;
  breakMinutes: number;
  lateMinutes: number;
  earlyExitMinutes: number;
  overtimeMinutes: number;
  nightMinutes: number;
  arrivalAt: Date | null;
  departureAt: Date | null;
  isWfh: boolean;
  flags: string[];
  shiftId: string | null;
  shiftSource: string;
  shiftKind: string | null;
  shiftStart: string | null;
  shiftEnd: string | null;
  departmentId: string | null;
  calculationVersion: number;
  recalculating: boolean;
}

const RECORD_COLUMNS = sql`
  r.user_id, u.employee_id, r.work_date::text AS work_date, r.state, r.status, r.day_type,
  r.present_units, r.paid_leave_units, r.unpaid_leave_units, r.absent_units, r.holiday_units,
  r.worked_minutes, r.break_minutes, r.late_minutes, r.early_exit_minutes, r.overtime_minutes,
  r.night_minutes, r.arrival_at, r.departure_at, r.is_wfh, r.flags,
  r.shift_snapshot->>'shiftId' AS shift_id, r.shift_source,
  r.shift_snapshot->>'kind' AS shift_kind, r.shift_snapshot->>'start' AS shift_start,
  r.shift_snapshot->>'end' AS shift_end,
  r.placement_snapshot->>'departmentId' AS department_id,
  r.calculation_version, r.calculated_input_version < r.input_version AS recalculating
`;

/** The days in `from..to` the caller's scope reaches, optionally for one person. */
export async function listRecordsInRange(
  tx: Tx,
  visibility: SqlFragment,
  from: DateOnly,
  to: DateOnly,
  userId: string | null,
): Promise<RecordListRow[]> {
  return tx.query<RecordListRow>(sql`
    SELECT ${RECORD_COLUMNS}
    FROM attendance_record r
    JOIN app_user u ON u.organization_id = r.organization_id AND u.id = r.user_id
    WHERE r.work_date BETWEEN ${from} AND ${to}
      AND (${userId}::uuid IS NULL OR r.user_id = ${userId}::uuid)
      AND ${visibility}
    ORDER BY r.work_date, u.employee_id, r.user_id
  `);
}

/** The employees the caller's scope reaches: who an export may contain. */
export async function visibleEmployeeIds(
  tx: Tx,
  visibility: SqlFragment,
): Promise<string[]> {
  const rows = await tx.query<{ id: string }>(sql`
    SELECT u.id FROM app_user u
    WHERE u.account_type = 'employee' AND ${visibility}
    ORDER BY u.id
  `);
  return rows.map((row) => row.id);
}

/* ------------------------------------------------------------------ *
 * Export requests
 * ------------------------------------------------------------------ */

export type ExportState = 'queued' | 'running' | 'completed' | 'failed';

export interface ExportRequestRow {
  id: string;
  requestedBy: string;
  fromDate: DateOnly;
  toDate: DateOnly;
  userIds: string[];
  format: 'csv' | 'xlsx';
  status: ExportState;
  objectKey: string | null;
  rowCount: number | null;
  errorMessage: string | null;
}

export async function insertExportRequest(
  tx: Tx,
  input: {
    organizationId: string;
    requestedBy: string;
    from: DateOnly;
    to: DateOnly;
    userIds: readonly string[];
    format?: 'csv' | 'xlsx';
  },
): Promise<string> {
  const row = await tx.one<{ id: string }>(sql`
    INSERT INTO attendance_export_request (organization_id, requested_by, from_date, to_date, user_ids, format)
    VALUES (${input.organizationId}, ${input.requestedBy}, ${input.from}, ${input.to},
            ${[...input.userIds]}::uuid[], ${input.format ?? 'csv'})
    RETURNING id
  `);
  return row.id;
}

export async function findExportRequest(
  tx: Tx,
  id: string,
): Promise<ExportRequestRow | null> {
  return tx.maybeOne<ExportRequestRow>(sql`
    SELECT id, requested_by, from_date::text AS from_date, to_date::text AS to_date,
           user_ids::text[] AS user_ids, format, status, object_key, row_count, error_message
    FROM attendance_export_request WHERE id = ${id}
  `);
}

export async function markExportRunning(tx: Tx, id: string): Promise<void> {
  await tx.query(sql`
    UPDATE attendance_export_request SET status = 'running', error_message = NULL
    WHERE id = ${id} AND status IN ('queued', 'running', 'failed')
  `);
}

export async function markExportCompleted(
  tx: Tx,
  id: string,
  objectKey: string,
  rowCount: number,
): Promise<void> {
  await tx.query(sql`
    UPDATE attendance_export_request
    SET status = 'completed', object_key = ${objectKey}, row_count = ${rowCount},
        error_message = NULL, completed_at = now()
    WHERE id = ${id}
  `);
}

export async function markExportFailed(
  tx: Tx,
  id: string,
  message: string,
): Promise<void> {
  await tx.query(sql`
    UPDATE attendance_export_request SET status = 'failed', error_message = ${message}
    WHERE id = ${id} AND status <> 'completed'
  `);
}

/** One page of an export's days, in (date, person) order. */
export async function exportPage(
  tx: Tx,
  userIds: readonly string[],
  from: DateOnly,
  to: DateOnly,
  after: { workDate: DateOnly; userId: string } | null,
  limit: number,
): Promise<RecordListRow[]> {
  return tx.query<RecordListRow>(sql`
    SELECT ${RECORD_COLUMNS}
    FROM attendance_record r
    JOIN app_user u ON u.organization_id = r.organization_id AND u.id = r.user_id
    WHERE r.user_id = ANY(${[...userIds]}::uuid[])
      AND r.work_date BETWEEN ${from} AND ${to}
      AND (${after?.workDate ?? null}::date IS NULL
           OR (r.work_date, r.user_id) > (${after?.workDate ?? null}::date, ${after?.userId ?? null}::uuid))
    ORDER BY r.work_date, r.user_id
    LIMIT ${limit}
  `);
}

/** AT-14: every export is audited, in the transaction that requested it. */
export async function auditExportRequested(
  tx: Tx,
  ctx: RequestContext,
  requestId: string,
  detail: { from: DateOnly; to: DateOnly; people: number },
): Promise<void> {
  await tx.query(sql`
    INSERT INTO audit_outbox (organization_id, stream, payload)
    VALUES (${ctx.organizationId}, 'access', ${JSON.stringify({
      action: 'attendance:export',
      actorId: ctx.principal.id,
      actorType: ctx.principal.accountType,
      targetType: 'attendanceExport',
      targetId: requestId,
      before: null,
      after: detail,
      reason: null,
      requestId: ctx.requestId,
      sourceIp: ctx.sourceIp,
    })}::jsonb)
  `);
}

/** The outbox row whose handler queues the export job after commit (TX-2). */
export async function writeExportRequested(
  tx: Tx,
  organizationId: string,
  requestId: string,
): Promise<void> {
  await tx.query(sql`
    INSERT INTO domain_outbox (organization_id, event_name, payload)
    VALUES (${organizationId}, ${ATTENDANCE_EVENTS.EXPORT_REQUESTED}, ${JSON.stringify({ requestId })}::jsonb)
  `);
}
