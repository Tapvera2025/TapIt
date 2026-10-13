import type { Tx } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';

/**
 * Attendance read models for the TA module. TA must not read `attendance_record`
 * itself (SH-1: the table belongs to attendance), so the queries live here and
 * TA reaches them through `attendance/facade.ts`.
 */

export interface TaAttendanceTotals {
  presentDays: string;
  halfDays: string;
  absentDays: string;
  leaveDays: string;
  holidayDays: string;
  eligibleDays: string;
}

/**
 * Day totals for one person across an assignment's window, clipped to the TA
 * month. `effectiveTo` null means "to the end of the month".
 */
export async function taAttendanceTotals(
  tx: Tx,
  input: {
    organizationId: string;
    userId: string;
    effectiveFrom: string;
    effectiveTo: string | null;
    monthStart: string;
    monthEnd: string;
  },
): Promise<TaAttendanceTotals> {
  return tx.one<TaAttendanceTotals>(sql`
    SELECT
      COALESCE(count(*) FILTER (WHERE r.status='present'), 0)::text AS "presentDays",
      COALESCE(sum(CASE WHEN r.present_units=1 THEN 1 ELSE 0 END), 0)::text AS "halfDays",
      COALESCE(sum(r.absent_units), 0)::numeric / 2::numeric AS "absentDays",
      COALESCE(sum(r.paid_leave_units + r.unpaid_leave_units), 0)::numeric / 2::numeric AS "leaveDays",
      COALESCE(sum(r.holiday_units), 0)::numeric / 2::numeric AS "holidayDays",
      COALESCE(sum(r.present_units), 0)::numeric / 2::numeric AS "eligibleDays"
    FROM attendance_record r
    WHERE r.organization_id=${input.organizationId}
      AND r.user_id=${input.userId}::uuid
      AND r.work_date BETWEEN ${input.effectiveFrom}::date AND COALESCE(${input.effectiveTo}::date, ${input.monthEnd}::date)
      AND r.work_date >= ${input.monthStart}::date
      AND r.work_date <= ${input.monthEnd}::date
      AND r.status IS NOT NULL
  `);
}

export interface TaAttendanceDay {
  workDate: string;
  status: string | null;
  presentUnits: number;
  eligibleUnits: string;
}

/** One person's attendance for every day of a month, oldest first. */
export async function taAttendanceDays(
  tx: Tx,
  input: { organizationId: string; userId: string; monthStart: string },
): Promise<TaAttendanceDay[]> {
  return tx.query<TaAttendanceDay>(sql`
    SELECT r.work_date::text AS "workDate", r.status, r.present_units AS "presentUnits",
      CASE WHEN r.present_units > 0 THEN r.present_units::numeric / 2 ELSE 0 END AS "eligibleUnits"
    FROM attendance_record r
    WHERE r.organization_id=${input.organizationId} AND r.user_id=${input.userId}::uuid
      AND r.work_date >= ${input.monthStart}::date
      AND r.work_date < (${input.monthStart}::date + interval '1 month')
    ORDER BY r.work_date
  `);
}
