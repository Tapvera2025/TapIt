import { effectivePolicy, visibilityFilter } from '@tapcrm/authz';
import { globalAccess, type DateOnly } from '@tapcrm/contracts';
import { ApplicationError } from '../../errors.js';
import type { RequestContext } from '../../platform/dal/context.js';
import { db } from '../../platform/dal/db.js';
import { getStorageService } from '../../platform/storage/index.js';
import { daysBetween } from '../../platform/time.js';
import * as api from './api-repository.js';
import { ATTENDANCE_ERROR_CODES, AttendanceNotFoundError } from './errors.js';
import type { ExportBody } from './validators.js';

/**
 * Attendance export (§8.7, SE-6, AT-7, AT-14).
 *
 *   POST /api/attendance/export        records the request, answers 202
 *   attendance.export (job)            writes the CSV to storage
 *   GET  /api/attendance/exports/:id   the status; once the file exists, a
 *                                      signed link that expires in 15 minutes
 *
 * Who is in an export is decided once, at the POST: the people the caller's
 * `attendance:export` scope reaches, narrowed by any `userIds` they named.
 * The job reads that frozen list and never re-evaluates scope, so a scope
 * change between request and run neither leaks nor hides anyone.
 */

/** An export spans at most a year. */
export const MAX_EXPORT_DAYS = 366;
/** SE-6: download links are short-lived. */
export const DOWNLOAD_LINK_SECONDS = 15 * 60;
const PAGE = 5_000;

/**
 * The public CSV contract. An explicit, stable list, not a projection of
 * whatever `attendance_record` holds today: HR and payroll systems parse this
 * file with fixed schemas. Extending it is a deliberate change — add the
 * column here and to the test's expected header, and tell the consumers.
 * The order below is the header order.
 */
export const EXPORT_COLUMNS = [
  'user_id',
  'employee_id',
  'work_date',
  'status',
  'present_units',
  'paid_leave_units',
  'unpaid_leave_units',
  'absent_units',
  'holiday_units',
  'worked_minutes',
  'late_minutes',
  'early_exit_minutes',
  'overtime_minutes',
  'night_minutes',
  'shift_id',
  'shift_source',
  'day_type',
  'department_id',
  'flags',
  'recalculating',
  'calculation_version',
  'correction_reasons',
] as const;

export type ExportColumn = (typeof EXPORT_COLUMNS)[number];

/** RFC 4180: quote a field that holds a comma, a quote or a line break. */
function csvField(value: string | number | boolean | null): string {
  if (value === null) return '';
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function csvLine(values: readonly (string | number | boolean | null)[]): string {
  return `${values.map(csvField).join(',')}\r\n`;
}

function exportValues(
  row: api.RecordListRow,
): Record<ExportColumn, string | number | boolean | null> {
  return {
    user_id: row.userId,
    employee_id: row.employeeId,
    work_date: row.workDate,
    status: row.status,
    present_units: row.presentUnits,
    paid_leave_units: row.paidLeaveUnits,
    unpaid_leave_units: row.unpaidLeaveUnits,
    absent_units: row.absentUnits,
    holiday_units: row.holidayUnits,
    worked_minutes: row.workedMinutes,
    late_minutes: row.lateMinutes,
    early_exit_minutes: row.earlyExitMinutes,
    overtime_minutes: row.overtimeMinutes,
    night_minutes: row.nightMinutes,
    shift_id: row.shiftId,
    shift_source: row.shiftSource,
    day_type: row.dayType,
    department_id: row.departmentId,
    flags: row.flags.join(';'),
    recalculating: row.recalculating,
    calculation_version: row.calculationVersion,
    // Corrections arrive with step 7 (§12); the column is part of the contract now.
    correction_reasons: null,
  };
}

export function csvRow(row: api.RecordListRow): string {
  const values = exportValues(row);
  return csvLine(EXPORT_COLUMNS.map((column) => values[column]));
}

export const CSV_HEADER = csvLine(EXPORT_COLUMNS);

export const exportObjectKey = (organizationId: string, requestId: string) =>
  `attendance-exports/${organizationId}/${requestId}.csv`;

/**
 * POST /api/attendance/export. Freezes who is in the export, records the
 * request with its audit entry (AT-14) and the outbox row that queues the job
 * (TX-2), all in one transaction, and answers 202.
 */
export async function requestExport(
  ctx: RequestContext,
  body: ExportBody,
): Promise<{ jobId: string; status: 'queued' }> {
  if (daysBetween(body.from, body.to) + 1 > MAX_EXPORT_DAYS) {
    throw new ApplicationError(
      `An export covers at most ${MAX_EXPORT_DAYS} days.`,
      422,
      ATTENDANCE_ERROR_CODES.EXPORT_RANGE_TOO_LONG,
      { maxDays: MAX_EXPORT_DAYS },
    );
  }
  const visibility = await visibilityFilter(ctx, 'attendance:export', 'attendanceRecord');
  return db.transaction(ctx, async (tx) => {
    const visible = await api.visibleEmployeeIds(tx, visibility);
    // `userIds` narrows; it never widens. Someone outside the caller's scope
    // simply is not in the export.
    const named = body.userIds === undefined ? null : new Set(body.userIds);
    const people = named === null ? visible : visible.filter((id) => named.has(id));
    if (people.length === 0) {
      throw new ApplicationError(
        'Nobody you asked for is within your export scope.',
        403,
        ATTENDANCE_ERROR_CODES.EXPORT_EMPTY_SCOPE,
      );
    }
    const jobId = await api.insertExportRequest(tx, {
      organizationId: ctx.organizationId,
      requestedBy: ctx.principal.id,
      from: body.from,
      to: body.to,
      userIds: people,
    });
    await api.auditExportRequested(tx, ctx, jobId, {
      from: body.from,
      to: body.to,
      people: people.length,
    });
    await api.writeExportRequested(tx, ctx.organizationId, jobId);
    return { jobId, status: 'queued' as const };
  });
}

export interface ExportStatus {
  readonly jobId: string;
  readonly status: api.ExportState;
  readonly from: DateOnly;
  readonly to: DateOnly;
  readonly rowCount: number | null;
  readonly errorMessage: string | null;
  /** Only once the file exists, and valid for 15 minutes from this response. */
  readonly downloadUrl: string | null;
}

/**
 * GET /api/attendance/exports/:jobId. The export belongs to whoever asked for
 * it; an administrator (`attendance:export` at all-people) may read any. To
 * anyone else it does not exist: 404, not 403, so its existence does not leak.
 */
export async function getExportStatus(
  ctx: RequestContext,
  jobId: string,
): Promise<ExportStatus> {
  const policy = await effectivePolicy(ctx, 'attendance:export');
  const administrator =
    globalAccess(ctx.principal) ||
    (policy?.allowed === true && policy.scope === 'all-people');
  const row = await db.transaction(ctx, (tx) => api.findExportRequest(tx, jobId));
  if (row === null || (row.requestedBy !== ctx.principal.id && !administrator)) {
    throw new AttendanceNotFoundError(
      ATTENDANCE_ERROR_CODES.EXPORT_NOT_FOUND,
      'There is no such export.',
    );
  }
  const downloadUrl =
    row.status === 'completed' && row.objectKey !== null
      ? getStorageService().presignedGetUrl({
          bucket: 'files',
          key: row.objectKey,
          expiresInSeconds: DOWNLOAD_LINK_SECONDS,
        })
      : null;
  return {
    jobId: row.id,
    status: row.status,
    from: row.fromDate,
    to: row.toDate,
    rowCount: row.rowCount,
    errorMessage: row.errorMessage,
    downloadUrl,
  };
}

/**
 * The `attendance.export` job. Reads the frozen list of people, writes the
 * CSV to storage and marks the request completed. A completed request is
 * never written again. On its last attempt a failure is recorded on the
 * request, so the requester sees it rather than waiting for ever.
 */
export async function runExport(
  ctx: RequestContext,
  requestId: string,
  lastAttempt: boolean,
): Promise<number> {
  const request = await db.transaction(ctx, async (tx) => {
    const row = await api.findExportRequest(tx, requestId);
    if (row !== null && row.status !== 'completed')
      await api.markExportRunning(tx, requestId);
    return row;
  });
  if (request === null || request.status === 'completed') return 0;
  try {
    const chunks: string[] = [CSV_HEADER];
    let rows = 0;
    let after: { workDate: DateOnly; userId: string } | null = null;
    for (;;) {
      const cursor: { workDate: DateOnly; userId: string } | null = after;
      const page: api.RecordListRow[] = await db.transaction(ctx, (tx) =>
        api.exportPage(
          tx,
          request.userIds,
          request.fromDate,
          request.toDate,
          cursor,
          PAGE,
        ),
      );
      for (const row of page) chunks.push(csvRow(row));
      rows += page.length;
      const last = page[page.length - 1];
      if (page.length < PAGE || last === undefined) break;
      after = { workDate: last.workDate, userId: last.userId };
    }
    const key = exportObjectKey(ctx.organizationId, requestId);
    await getStorageService().putObject({
      bucket: 'files',
      key,
      body: Buffer.from(chunks.join(''), 'utf8'),
      contentType: 'text/csv; charset=utf-8',
    });
    await db.transaction(ctx, (tx) => api.markExportCompleted(tx, requestId, key, rows));
    return rows;
  } catch (error) {
    if (lastAttempt) {
      const message = error instanceof Error ? error.message : String(error);
      await db.transaction(ctx, (tx) => api.markExportFailed(tx, requestId, message));
    }
    throw error;
  }
}
