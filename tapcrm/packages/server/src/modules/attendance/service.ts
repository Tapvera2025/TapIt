import { visibilityFilter } from '@tapcrm/authz';
import type { DateOnly } from '@tapcrm/contracts';
import { ApplicationError } from '../../errors.js';
import type { RequestContext } from '../../platform/dal/context.js';
import { db } from '../../platform/dal/db.js';
import { daysBetween } from '../../platform/time.js';
import * as api from './api-repository.js';
import { loadDayDetail, type AttendanceDayDetail } from './detail.js';
import { ATTENDANCE_ERROR_CODES, AttendanceNotFoundError } from './errors.js';
import type { ListQuery } from './validators.js';

/** AT-13: the read API serves at most a quarter; anything longer is an export. */
export const MAX_READ_DAYS = 92;

/** One stored day as the list returns it: what the calculator stored, nothing computed (L17). */
export interface AttendanceDayView {
  readonly userId: string;
  readonly employeeId: string | null;
  readonly workDate: DateOnly;
  readonly state: 'open' | 'closed';
  readonly status: string | null;
  readonly dayType: string;
  readonly units: {
    readonly present: number;
    readonly paidLeave: number; // a half-day count, not money (CI-21)
    readonly unpaidLeave: number;
    readonly absent: number;
    readonly holiday: number;
  };
  readonly minutes: {
    readonly worked: number;
    readonly break: number;
    readonly late: number;
    readonly earlyExit: number;
    readonly overtime: number;
    readonly night: number;
  };
  readonly arrivalAt: string | null;
  readonly departureAt: string | null;
  readonly isWfh: boolean;
  readonly flags: readonly string[];
  readonly shift: {
    readonly shiftId: string | null;
    readonly source: string;
    readonly kind: string | null;
    readonly start: string | null;
    readonly end: string | null;
  };
  /** Newer inputs are waiting to be calculated: show "recalculating" (§8.5). */
  readonly recalculating: boolean;
}

function toView(row: api.RecordListRow): AttendanceDayView {
  return {
    userId: row.userId,
    employeeId: row.employeeId,
    workDate: row.workDate,
    state: row.state,
    status: row.status,
    dayType: row.dayType,
    units: {
      present: row.presentUnits,
      paidLeave: row.paidLeaveUnits,
      unpaidLeave: row.unpaidLeaveUnits,
      absent: row.absentUnits,
      holiday: row.holidayUnits,
    },
    minutes: {
      worked: row.workedMinutes,
      break: row.breakMinutes,
      late: row.lateMinutes,
      earlyExit: row.earlyExitMinutes,
      overtime: row.overtimeMinutes,
      night: row.nightMinutes,
    },
    arrivalAt: row.arrivalAt?.toISOString() ?? null,
    departureAt: row.departureAt?.toISOString() ?? null,
    isWfh: row.isWfh,
    flags: row.flags,
    shift: {
      shiftId: row.shiftId,
      source: row.shiftSource,
      kind: row.shiftKind,
      start: row.shiftStart,
      end: row.shiftEnd,
    },
    recalculating: row.recalculating,
  };
}

/** GET /api/attendance — the stored days in range, for the people the caller's scope reaches. */
export async function listRecords(
  ctx: RequestContext,
  query: ListQuery,
): Promise<{ records: AttendanceDayView[] }> {
  if (daysBetween(query.from, query.to) + 1 > MAX_READ_DAYS) {
    throw new ApplicationError(
      `A range longer than ${MAX_READ_DAYS} days is an export: POST /api/attendance/export.`,
      422,
      ATTENDANCE_ERROR_CODES.RANGE_TOO_LONG,
      { maxDays: MAX_READ_DAYS, export: '/api/attendance/export' },
    );
  }
  const visibility = await visibilityFilter(ctx, 'attendance:view', 'attendanceRecord');
  const rows = await db.transaction(ctx, (tx) =>
    api.listRecordsInRange(tx, visibility, query.from, query.to, query.userId ?? null),
  );
  return { records: rows.map(toView) };
}

/** GET /api/attendance/:userId/:date — the router has already checked the person is in scope. */
export async function dayDetail(
  ctx: RequestContext,
  userId: string,
  date: DateOnly,
): Promise<AttendanceDayDetail> {
  const detail = await loadDayDetail(ctx, userId, date);
  if (detail === null) {
    throw new AttendanceNotFoundError(
      ATTENDANCE_ERROR_CODES.DAY_NOT_FOUND,
      'There is no attendance day for this person on this date.',
    );
  }
  return detail;
}
