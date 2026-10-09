import type { SqlFragment } from '@tapcrm/authz';
import type { DateOnly } from '@tapcrm/contracts';
import type { Tx } from '../../../platform/dal/db.js';
import { sql } from '../../../platform/dal/sql.js';

export interface MonthlyReportFilter {
  departmentId?: string;
  teamId?: string;
  positionId?: string;
  shiftId?: string;
  employeeId?: string;
}

export interface MonthlyReportRow {
  id: string;
  employeeId: string | null;
  fullName: string;
  email: string | null;
  departmentName: string | null;
  teamName: string | null;
  positionName: string | null;
  designationName: string | null;
  shift: { kind: string | null; start: string | null; end: string | null; source: string } | null;
  presentUnits: number;
  paidLeaveUnits: number;
  unpaidLeaveUnits: number;
  absentUnits: number;
  holidayUnits: number;
  workedMinutes: number;
  breakMinutes: number;
  lateDays: number;
  lateMinutes: number;
  overtimeMinutes: number;
  wfhDays: number;
  records: Array<{
    date: DateOnly;
    status: string | null;
    dayType: string;
    isWfh: boolean;
    arrivalAt: string | null;
    departureAt: string | null;
    workedMinutes: number;
    breakMinutes: number;
    lateMinutes: number;
    overtimeMinutes: number;
    shift: unknown;
    shiftSource: string;
    flags: string[];
  }>;
}

export interface DailyLateRow {
  id: string;
  employeeId: string | null;
  fullName: string;
  departmentName: string | null;
  teamName: string | null;
  positionName: string | null;
  designationName: string | null;
  shift: { kind: string | null; start: string | null; end: string | null; graceMinutes: number | null; source: string };
  arrivalAt: string | null;
  lateMinutes: number;
  isWfh: boolean;
  flags: string[];
}

export interface DailyAttendanceRow extends Omit<DailyLateRow, 'lateMinutes'> {
  status: string | null;
  dayType: string;
  departureAt: string | null;
  workedMinutes: number;
  breakMinutes: number;
  lateMinutes: number;
  overtimeMinutes: number;
}

export interface MonthlyLateRow {
  id: string;
  employeeId: string | null;
  fullName: string;
  departmentName: string | null;
  teamName: string | null;
  positionName: string | null;
  designationName: string | null;
  lateDays: number;
  lateMinutes: number;
  averageLateMinutes: number;
  maximumLateMinutes: number;
}

export interface EmployeeSearchRow {
  id: string;
  employeeId: string | null;
  fullName: string;
  email: string | null;
  departmentName: string | null;
  teamName: string | null;
  positionName: string | null;
}

export interface EmployeeProfileRow extends EmployeeSearchRow {
  departmentId: string | null;
  teamId: string | null;
  positionId: string | null;
  designationName: string | null;
  specialization: string | null;
}

export interface EmployeeReportDayRow {
  workDate: DateOnly;
  status: string | null;
  dayType: string;
  presentUnits: number;
  paidLeaveUnits: number;
  unpaidLeaveUnits: number;
  absentUnits: number;
  holidayUnits: number;
  workedMinutes: number;
  breakMinutes: number;
  lateMinutes: number;
  overtimeMinutes: number;
  arrivalAt: Date | null;
  departureAt: Date | null;
  isWfh: boolean;
  flags: string[];
  shift: unknown;
  shiftSource: string;
  recalculating: boolean;
}

export interface EmployeeSummaryRow {
  days: number;
  presentUnits: number;
  paidLeaveUnits: number;
  unpaidLeaveUnits: number;
  absentUnits: number;
  holidayUnits: number;
  workedMinutes: number;
  breakMinutes: number;
  lateDays: number;
  lateMinutes: number;
  overtimeMinutes: number;
  wfhDays: number;
  halfDays: number;
  staleDays: number;
}

export async function findEmployee(tx: Tx, userId: string, visibility: SqlFragment): Promise<EmployeeProfileRow | null> {
  return tx.maybeOne<EmployeeProfileRow>(sql`
    SELECT u.id, u.employee_id, u.full_name, u.email::text AS email,
           u.department_id, d.name AS department_name,
           u.team_id, t.name AS team_name,
           u.position_id, p.name AS position_name,
           des.name AS designation_name, u.specialization
    FROM app_user u
    LEFT JOIN department d ON d.organization_id = u.organization_id AND d.id = u.department_id
    LEFT JOIN team t ON t.organization_id = u.organization_id AND t.id = u.team_id
    LEFT JOIN position p ON p.organization_id = u.organization_id AND p.id = u.position_id
    LEFT JOIN designation des ON des.organization_id = u.organization_id AND des.id = u.designation_id
    WHERE u.account_type = 'employee' AND u.id = ${userId}::uuid AND ${visibility}
  `);
}

export async function searchEmployees(tx: Tx, visibility: SqlFragment, search: string, limit: number): Promise<EmployeeSearchRow[]> {
  const pattern = `%${search.toLowerCase()}%`;
  return tx.query<EmployeeSearchRow>(sql`
    SELECT u.id, u.employee_id, u.full_name, u.email::text AS email,
           d.name AS department_name, t.name AS team_name, p.name AS position_name
    FROM app_user u
    LEFT JOIN department d ON d.organization_id = u.organization_id AND d.id = u.department_id
    LEFT JOIN team t ON t.organization_id = u.organization_id AND t.id = u.team_id
    LEFT JOIN position p ON p.organization_id = u.organization_id AND p.id = u.position_id
    WHERE u.account_type = 'employee' AND u.status = 'active'
      AND (${search} = '' OR lower(u.full_name) LIKE ${pattern}
           OR lower(coalesce(u.employee_id, '')) LIKE ${pattern}
           OR lower(coalesce(u.email::text, '')) LIKE ${pattern})
      AND ${visibility}
    ORDER BY lower(u.full_name), u.id LIMIT ${limit}
  `);
}

export async function findMonthlySummary(tx: Tx, userId: string, month: string): Promise<EmployeeSummaryRow | null> {
  return tx.maybeOne<EmployeeSummaryRow>(sql`
    SELECT s.days, s.present_units, s.paid_leave_units, s.unpaid_leave_units,
           s.absent_units, s.holiday_units, s.worked_minutes,
           coalesce(sum(r.break_minutes), 0)::int AS break_minutes,
           s.late_days,
           s.late_minutes, s.overtime_minutes, s.wfh_days,
           count(r.id) FILTER (WHERE r.status IN ('half-day', 'half-day-leave'))::int AS half_days,
           s.stale_days
    FROM attendance_month_summary s
    LEFT JOIN attendance_record r
      ON r.organization_id = s.organization_id AND r.user_id = s.user_id
     AND r.work_date >= s.month AND r.work_date < (s.month + INTERVAL '1 month')
    WHERE s.user_id = ${userId}::uuid AND s.month = ${`${month}-01`}::date
    GROUP BY s.organization_id, s.user_id, s.month, s.days, s.present_units,
      s.paid_leave_units, s.unpaid_leave_units, s.absent_units, s.holiday_units,
      s.worked_minutes, s.late_days, s.late_minutes, s.overtime_minutes,
      s.wfh_days, s.stale_days
  `);
}

export async function findMonthlyDays(tx: Tx, userId: string, from: DateOnly, to: DateOnly): Promise<EmployeeReportDayRow[]> {
  return tx.query<EmployeeReportDayRow>(sql`
    SELECT r.work_date::text AS work_date, r.status, r.day_type,
           r.present_units, r.paid_leave_units, r.unpaid_leave_units,
           r.absent_units, r.holiday_units, r.worked_minutes, r.break_minutes,
           r.late_minutes, r.overtime_minutes, r.arrival_at, r.departure_at,
           r.is_wfh, r.flags, r.shift_snapshot AS shift, r.shift_source,
           (r.calculated_input_version < r.input_version) AS recalculating
    FROM attendance_record r
    WHERE r.user_id = ${userId}::uuid AND r.work_date BETWEEN ${from} AND ${to}
    ORDER BY r.work_date
  `);
}

function monthlyPredicates(filter: MonthlyReportFilter, visibility: SqlFragment, from: DateOnly, to: DateOnly) {
  const predicates: SqlFragment[] = [sql`u.account_type = 'employee'`, visibility];
  if (filter.departmentId) predicates.push(sql`u.department_id = ${filter.departmentId}::uuid`);
  if (filter.teamId) predicates.push(sql`u.team_id = ${filter.teamId}::uuid`);
  if (filter.positionId) predicates.push(sql`u.position_id = ${filter.positionId}::uuid`);
  if (filter.employeeId) predicates.push(sql`u.id = ${filter.employeeId}::uuid`);
  if (filter.shiftId) predicates.push(sql`EXISTS (
    SELECT 1 FROM attendance_record sr
    WHERE sr.organization_id = u.organization_id AND sr.user_id = u.id
      AND sr.work_date BETWEEN ${from} AND ${to}
      AND sr.shift_snapshot->>'shiftId' = ${filter.shiftId}
  )`);
  return predicates;
}

function dailyPredicates(filter: MonthlyReportFilter, visibility: SqlFragment, date: DateOnly) {
  const predicates: SqlFragment[] = [sql`u.account_type = 'employee'`, visibility, sql`r.work_date = ${date}`, sql`r.late_minutes > 0`];
  if (filter.departmentId) predicates.push(sql`u.department_id = ${filter.departmentId}::uuid`);
  if (filter.teamId) predicates.push(sql`u.team_id = ${filter.teamId}::uuid`);
  if (filter.positionId) predicates.push(sql`u.position_id = ${filter.positionId}::uuid`);
  if (filter.employeeId) predicates.push(sql`u.id = ${filter.employeeId}::uuid`);
  if (filter.shiftId) predicates.push(sql`r.shift_snapshot->>'shiftId' = ${filter.shiftId}`);
  return predicates;
}

function attendanceDayPredicates(visibility: SqlFragment, date: DateOnly, shiftId?: string) {
  const predicates: SqlFragment[] = [sql`u.account_type = 'employee'`, visibility];
  if (shiftId) predicates.push(sql`r.shift_snapshot->>'shiftId' = ${shiftId}`);
  return predicates;
}

export async function countDailyAttendance(tx: Tx, visibility: SqlFragment, date: DateOnly, shiftId?: string): Promise<number> {
  const predicates = attendanceDayPredicates(visibility, date, shiftId);
  const row = await tx.one<{ total: number }>(sql`SELECT count(*)::int AS total FROM app_user u LEFT JOIN attendance_record r ON r.organization_id = u.organization_id AND r.user_id = u.id AND r.work_date = ${date} WHERE ${sql.join(predicates, ' AND ')}`);
  return row.total;
}

export async function listDailyAttendance(tx: Tx, visibility: SqlFragment, date: DateOnly, shiftId: string | undefined, page: number, pageSize: number): Promise<DailyAttendanceRow[]> {
  const predicates = attendanceDayPredicates(visibility, date, shiftId);
  return tx.query<DailyAttendanceRow>(sql`
    SELECT u.id, u.employee_id, u.full_name, d.name AS department_name,
           t.name AS team_name, p.name AS position_name, des.name AS designation_name,
           r.status, r.day_type, r.arrival_at, r.departure_at, coalesce(r.worked_minutes, 0)::int AS worked_minutes,
           coalesce(r.break_minutes, 0)::int AS break_minutes, coalesce(r.late_minutes, 0)::int AS late_minutes,
           coalesce(r.overtime_minutes, 0)::int AS overtime_minutes, coalesce(r.is_wfh, false) AS is_wfh,
           coalesce(r.flags, ARRAY[]::text[]) AS flags,
           json_build_object('kind', r.shift_snapshot->>'kind', 'start', r.shift_snapshot->>'start',
             'end', r.shift_snapshot->>'end', 'graceMinutes', nullif(r.shift_snapshot->>'graceMinutes', '')::int,
             'source', r.shift_source) AS shift
    FROM app_user u
    LEFT JOIN attendance_record r ON r.organization_id = u.organization_id AND r.user_id = u.id AND r.work_date = ${date}
    LEFT JOIN department d ON d.organization_id = u.organization_id AND d.id = u.department_id
    LEFT JOIN team t ON t.organization_id = u.organization_id AND t.id = u.team_id
    LEFT JOIN position p ON p.organization_id = u.organization_id AND p.id = u.position_id
    LEFT JOIN designation des ON des.organization_id = u.organization_id AND des.id = u.designation_id
    WHERE ${sql.join(predicates, ' AND ')}
    ORDER BY lower(u.full_name), u.id LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
  `);
}

export async function listDailyAttendanceEmployeeIds(tx: Tx, visibility: SqlFragment, date: DateOnly, shiftId?: string): Promise<string[]> {
  const predicates = attendanceDayPredicates(visibility, date, shiftId);
  const rows = await tx.query<{ id: string }>(sql`SELECT u.id FROM app_user u LEFT JOIN attendance_record r ON r.organization_id = u.organization_id AND r.user_id = u.id AND r.work_date = ${date} WHERE ${sql.join(predicates, ' AND ')} ORDER BY u.id`);
  return rows.map((row) => row.id);
}

export async function countDailyLate(tx: Tx, visibility: SqlFragment, filter: MonthlyReportFilter, date: DateOnly): Promise<number> {
  const where = sql.join(dailyPredicates(filter, visibility, date), ' AND ');
  const row = await tx.one<{ total: number }>(sql`SELECT count(*)::int AS total FROM attendance_record r JOIN app_user u ON u.organization_id = r.organization_id AND u.id = r.user_id WHERE ${where}`);
  return row.total;
}

export async function listDailyLate(tx: Tx, visibility: SqlFragment, filter: MonthlyReportFilter, date: DateOnly, page: number, pageSize: number): Promise<DailyLateRow[]> {
  const where = sql.join(dailyPredicates(filter, visibility, date), ' AND ');
  return tx.query<DailyLateRow>(sql`
    SELECT u.id, u.employee_id, u.full_name, d.name AS department_name,
           t.name AS team_name, p.name AS position_name, des.name AS designation_name,
           json_build_object('kind', r.shift_snapshot->>'kind', 'start', r.shift_snapshot->>'start',
             'end', r.shift_snapshot->>'end', 'graceMinutes', nullif(r.shift_snapshot->>'graceMinutes', '')::int,
             'source', r.shift_source) AS shift,
           r.arrival_at, r.late_minutes, r.is_wfh, r.flags
    FROM attendance_record r
    JOIN app_user u ON u.organization_id = r.organization_id AND u.id = r.user_id
    LEFT JOIN department d ON d.organization_id = u.organization_id AND d.id = u.department_id
    LEFT JOIN team t ON t.organization_id = u.organization_id AND t.id = u.team_id
    LEFT JOIN position p ON p.organization_id = u.organization_id AND p.id = u.position_id
    LEFT JOIN designation des ON des.organization_id = u.organization_id AND des.id = u.designation_id
    WHERE ${where}
    ORDER BY r.late_minutes DESC, lower(u.full_name), u.id
    LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
  `);
}

export async function listDailyLateEmployeeIds(tx: Tx, visibility: SqlFragment, filter: MonthlyReportFilter, date: DateOnly): Promise<string[]> {
  const where = sql.join(dailyPredicates(filter, visibility, date), ' AND ');
  const rows = await tx.query<{ id: string }>(sql`SELECT u.id FROM attendance_record r JOIN app_user u ON u.organization_id = r.organization_id AND u.id = r.user_id WHERE ${where} ORDER BY u.id`);
  return rows.map((row) => row.id);
}

export async function countMonthlyLate(tx: Tx, visibility: SqlFragment, filter: MonthlyReportFilter, from: DateOnly, to: DateOnly): Promise<number> {
  const where = sql.join(monthlyPredicates(filter, visibility, from, to), ' AND ');
  const row = await tx.one<{ total: number }>(sql`
    SELECT count(*)::int AS total FROM (
      SELECT u.id
      FROM app_user u
      LEFT JOIN attendance_month_summary s ON s.organization_id = u.organization_id AND s.user_id = u.id
        AND s.month = ${`${from.slice(0, 7)}-01`}::date
      WHERE ${where}
      GROUP BY u.id
      HAVING coalesce(max(s.late_minutes), 0) > 0
    ) late_people
  `);
  return row.total;
}

export async function listMonthlyLate(tx: Tx, visibility: SqlFragment, filter: MonthlyReportFilter, from: DateOnly, to: DateOnly, page: number, pageSize: number): Promise<MonthlyLateRow[]> {
  const where = sql.join(monthlyPredicates(filter, visibility, from, to), ' AND ');
  return tx.query<MonthlyLateRow>(sql`
    SELECT u.id, u.employee_id, u.full_name, d.name AS department_name,
           t.name AS team_name, p.name AS position_name, des.name AS designation_name,
           coalesce(max(s.late_days), 0)::int AS late_days,
           coalesce(max(s.late_minutes), 0)::int AS late_minutes,
           coalesce(avg(r.late_minutes) FILTER (WHERE r.late_minutes > 0), 0)::numeric::float8 AS average_late_minutes,
           coalesce(max(r.late_minutes), 0)::int AS maximum_late_minutes
    FROM app_user u
    LEFT JOIN department d ON d.organization_id = u.organization_id AND d.id = u.department_id
    LEFT JOIN team t ON t.organization_id = u.organization_id AND t.id = u.team_id
    LEFT JOIN position p ON p.organization_id = u.organization_id AND p.id = u.position_id
    LEFT JOIN designation des ON des.organization_id = u.organization_id AND des.id = u.designation_id
    LEFT JOIN attendance_month_summary s ON s.organization_id = u.organization_id AND s.user_id = u.id
      AND s.month = ${`${from.slice(0, 7)}-01`}::date
    LEFT JOIN attendance_record r ON r.organization_id = u.organization_id AND r.user_id = u.id
      AND r.work_date BETWEEN ${from} AND ${to}
    WHERE ${where}
    GROUP BY u.id, u.employee_id, u.full_name, d.name, t.name, p.name, des.name
    HAVING coalesce(max(s.late_minutes), 0) > 0
    ORDER BY max(s.late_minutes) DESC, lower(u.full_name), u.id
    LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
  `);
}

export async function listMonthlyLateEmployeeIds(tx: Tx, visibility: SqlFragment, filter: MonthlyReportFilter, from: DateOnly, to: DateOnly): Promise<string[]> {
  const where = sql.join(monthlyPredicates(filter, visibility, from, to), ' AND ');
  const rows = await tx.query<{ id: string }>(sql`
    SELECT u.id
    FROM app_user u
    LEFT JOIN attendance_month_summary s ON s.organization_id = u.organization_id AND s.user_id = u.id
      AND s.month = ${`${from.slice(0, 7)}-01`}::date
    WHERE ${where}
    GROUP BY u.id
    HAVING coalesce(max(s.late_minutes), 0) > 0
    ORDER BY u.id
  `);
  return rows.map((row) => row.id);
}

export async function countMonthlyEmployees(tx: Tx, visibility: SqlFragment, filter: MonthlyReportFilter, from: DateOnly, to: DateOnly): Promise<number> {
  const where = sql.join(monthlyPredicates(filter, visibility, from, to), ' AND ');
  const row = await tx.one<{ total: number }>(sql`SELECT count(*)::int AS total FROM app_user u WHERE ${where}`);
  return row.total;
}

export async function listMonthlyEmployeeIds(tx: Tx, visibility: SqlFragment, filter: MonthlyReportFilter, from: DateOnly, to: DateOnly): Promise<string[]> {
  const where = sql.join(monthlyPredicates(filter, visibility, from, to), ' AND ');
  const rows = await tx.query<{ id: string }>(sql`SELECT u.id FROM app_user u WHERE ${where} ORDER BY u.id`);
  return rows.map((row) => row.id);
}

export async function listMonthlyEmployees(
  tx: Tx,
  visibility: SqlFragment,
  filter: MonthlyReportFilter,
  from: DateOnly,
  to: DateOnly,
  page: number,
  pageSize: number,
): Promise<MonthlyReportRow[]> {
  const where = sql.join(monthlyPredicates(filter, visibility, from, to), ' AND ');
  return tx.query<MonthlyReportRow>(sql`
    SELECT u.id, u.employee_id, u.full_name, u.email::text AS email,
           d.name AS department_name, t.name AS team_name, p.name AS position_name,
           des.name AS designation_name,
           CASE WHEN count(r.id) = 0 THEN NULL ELSE json_build_object(
             'kind', CASE WHEN count(DISTINCT r.shift_snapshot->>'shiftId') > 1 THEN 'Multiple' ELSE (array_agg(r.shift_snapshot->>'kind' ORDER BY r.work_date))[1] END,
             'start', CASE WHEN count(DISTINCT r.shift_snapshot->>'shiftId') > 1 THEN NULL ELSE (array_agg(r.shift_snapshot->>'start' ORDER BY r.work_date))[1] END,
             'end', CASE WHEN count(DISTINCT r.shift_snapshot->>'shiftId') > 1 THEN NULL ELSE (array_agg(r.shift_snapshot->>'end' ORDER BY r.work_date))[1] END,
             'source', CASE WHEN count(DISTINCT r.shift_snapshot->>'shiftId') > 1 THEN 'historical' ELSE (array_agg(r.shift_source ORDER BY r.work_date))[1] END
           ) END AS shift,
           coalesce(max(s.present_units), 0)::int AS present_units,
           coalesce(max(s.paid_leave_units), 0)::int AS paid_leave_units,
           coalesce(max(s.unpaid_leave_units), 0)::int AS unpaid_leave_units,
           coalesce(max(s.absent_units), 0)::int AS absent_units,
           coalesce(max(s.holiday_units), 0)::int AS holiday_units,
           coalesce(max(s.worked_minutes), 0)::int AS worked_minutes,
           coalesce(sum(r.break_minutes), 0)::int AS break_minutes,
           coalesce(max(s.late_days), 0)::int AS late_days,
           coalesce(max(s.late_minutes), 0)::int AS late_minutes,
           coalesce(max(s.overtime_minutes), 0)::int AS overtime_minutes,
           coalesce(max(s.wfh_days), 0)::int AS wfh_days,
           coalesce(json_agg(json_build_object(
             'date', r.work_date::text, 'status', r.status, 'dayType', r.day_type,
             'isWfh', r.is_wfh, 'arrivalAt', r.arrival_at, 'departureAt', r.departure_at,
             'workedMinutes', r.worked_minutes, 'breakMinutes', r.break_minutes,
             'lateMinutes', r.late_minutes, 'overtimeMinutes', r.overtime_minutes,
             'shift', r.shift_snapshot, 'shiftSource', r.shift_source, 'flags', r.flags
           ) ORDER BY r.work_date) FILTER (WHERE r.id IS NOT NULL), '[]'::json) AS records
    FROM app_user u
    LEFT JOIN department d ON d.organization_id = u.organization_id AND d.id = u.department_id
    LEFT JOIN team t ON t.organization_id = u.organization_id AND t.id = u.team_id
    LEFT JOIN position p ON p.organization_id = u.organization_id AND p.id = u.position_id
    LEFT JOIN designation des ON des.organization_id = u.organization_id AND des.id = u.designation_id
    LEFT JOIN attendance_month_summary s ON s.organization_id = u.organization_id
      AND s.user_id = u.id AND s.month = ${`${from.slice(0, 7)}-01`}::date
    LEFT JOIN attendance_record r ON r.organization_id = u.organization_id AND r.user_id = u.id
      AND r.work_date BETWEEN ${from} AND ${to}
    WHERE ${where}
    GROUP BY u.id, u.employee_id, u.full_name, u.email, d.name, t.name, p.name, des.name
    ORDER BY lower(u.full_name), u.id
    LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
  `);
}
