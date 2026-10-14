import { randomUUID } from 'node:crypto';
import { visibilityFilter } from '@tapcrm/authz';
import type { RequestContext } from '../../../platform/dal/context.js';
import type { DateOnly } from '@tapcrm/contracts';
import { db } from '../../../platform/dal/db.js';
import { xlsxBuffer } from '../export.js';
import { AttendanceForbiddenError, ATTENDANCE_ERROR_CODES } from '../errors.js';
import * as repo from './repository.js';
import { monthBounds, type DailyAttendanceQuery, type DailyLateQuery, type MonthlyAttendanceQuery, type MonthlyReportQuery } from './validators.js';

export interface DirectExportFile { body: Buffer; contentType: string; filename: string; }
type Cell = string | number | boolean | null;

function requireSuperAdmin(ctx: RequestContext): void {
  if (ctx.principal.accountType !== 'super-admin') throw new AttendanceForbiddenError(ATTENDANCE_ERROR_CODES.EXPORT_SUPER_ADMIN_ONLY, 'Only Super Admin users can export attendance reports.');
}

function field(value: Cell): string {
  if (value === null) return '';
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
function csv(headers: readonly string[], rows: readonly Cell[][]): Buffer {
  return Buffer.from([headers, ...rows].map((row) => row.map(field).join(',')).join('\r\n') + '\r\n', 'utf8');
}
function filters(query: Record<string, unknown>): repo.MonthlyReportFilter {
  const result: repo.MonthlyReportFilter = {};
  for (const [key, value] of Object.entries(query)) {
    if (typeof value === 'string' && value.length > 0 && ['departmentId', 'teamId', 'positionId', 'shiftId', 'employeeId'].includes(key)) result[key as keyof repo.MonthlyReportFilter] = value;
  }
  return result;
}
function render(filename: string, headers: readonly string[], rows: Cell[][], format: 'csv' | 'xlsx'): DirectExportFile {
  return format === 'xlsx'
    ? { body: xlsxBuffer([headers, ...rows]), contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', filename: `${filename}.xlsx` }
    : { body: csv(headers, rows), contentType: 'text/csv; charset=utf-8', filename: `${filename}.csv` };
}

async function audit(ctx: RequestContext, from: DateOnly, to: DateOnly, people: number): Promise<void> {
  await db.transaction(ctx, async (tx) => {
    const { auditExportRequested } = await import('../api-repository.js');
    await auditExportRequested(tx, ctx, randomUUID(), { from, to, people });
  });
}

export async function exportDailyAttendance(ctx: RequestContext, query: DailyAttendanceQuery): Promise<DirectExportFile> {
  requireSuperAdmin(ctx);
  const visibility = await visibilityFilter(ctx, 'attendance:export', 'attendanceRecord');
  const rows = await db.transaction(ctx, async (tx) => {
    const total = await repo.countDailyAttendance(tx, visibility, query.date, query.shiftId);
    return repo.listDailyAttendance(tx, visibility, query.date, query.shiftId, 1, Math.max(total, 1));
  });
  await audit(ctx, query.date, query.date, rows.length);
  const headers = ['Employee ID', 'Name', 'Department', 'Team', 'Position', 'Date', 'Status', 'Day Type', 'Arrival', 'Departure', 'Worked Minutes', 'Break Minutes', 'Late Minutes', 'Overtime Minutes', 'WFH', 'Flags'];
  const data = rows.map((r) => [r.employeeId, r.fullName, r.departmentName, r.teamName, r.positionName, query.date, r.status, r.dayType, r.arrivalAt, r.departureAt, r.workedMinutes, r.breakMinutes, r.lateMinutes, r.overtimeMinutes, r.isWfh, r.flags.join(';')]);
  return render(`attendance-daily-${query.date}`, headers, data, query.format);
}

export async function exportMonthlyAttendance(ctx: RequestContext, query: MonthlyAttendanceQuery): Promise<DirectExportFile> {
  requireSuperAdmin(ctx);
  const visibility = await visibilityFilter(ctx, 'attendance:export', 'attendanceRecord'); const bounds = monthBounds(query);
  const rows = await db.transaction(ctx, async (tx) => { const total = await repo.countMonthlyEmployees(tx, visibility, filters({ shiftId: query.shiftId }), bounds.from, bounds.to); return repo.listMonthlyEmployees(tx, visibility, filters({ shiftId: query.shiftId }), bounds.from, bounds.to, 1, Math.max(total, 1)); });
  await audit(ctx, bounds.from, bounds.to, rows.length);
  const headers = ['Employee ID', 'Name', 'Department', 'Team', 'Position', 'Present Units', 'Paid Leave', 'Unpaid Leave', 'Absent Units', 'Holiday Units', 'Worked Minutes', 'Late Days', 'Late Minutes', 'Overtime Minutes', 'WFH Days'];
  const data = rows.map((r) => [r.employeeId, r.fullName, r.departmentName, r.teamName, r.positionName, r.presentUnits, r.paidLeaveUnits, r.unpaidLeaveUnits, r.absentUnits, r.holidayUnits, r.workedMinutes, r.lateDays, r.lateMinutes, r.overtimeMinutes, r.wfhDays]);
  return render(`attendance-monthly-${query.year}-${query.month}`, headers, data, query.format);
}

export async function exportDailyLate(ctx: RequestContext, query: DailyLateQuery): Promise<DirectExportFile> {
  requireSuperAdmin(ctx);
  const visibility = await visibilityFilter(ctx, 'attendance:export', 'attendanceRecord'); const filter = filters(query);
  const rows = await db.transaction(ctx, async (tx) => repo.listDailyLate(tx, visibility, filter, query.date, 1, Math.max(await repo.countDailyLate(tx, visibility, filter, query.date), 1)));
  await audit(ctx, query.date, query.date, rows.length);
  const headers = ['Employee ID', 'Name', 'Department', 'Team', 'Position', 'Date', 'Arrival', 'Late Minutes', 'WFH', 'Flags'];
  const data = rows.map((r) => [r.employeeId, r.fullName, r.departmentName, r.teamName, r.positionName, query.date, r.arrivalAt, r.lateMinutes, r.isWfh, r.flags.join(';')]);
  return render(`late-daily-${query.date}`, headers, data, query.format);
}

export async function exportMonthlyLate(ctx: RequestContext, query: MonthlyReportQuery): Promise<DirectExportFile> {
  requireSuperAdmin(ctx);
  const visibility = await visibilityFilter(ctx, 'attendance:export', 'attendanceRecord'); const bounds = monthBounds(query); const filter = filters(query);
  const rows = await db.transaction(ctx, async (tx) => { const total = await repo.countMonthlyLate(tx, visibility, filter, bounds.from, bounds.to); return repo.listMonthlyLate(tx, visibility, filter, bounds.from, bounds.to, 1, Math.max(total, 1)); });
  await audit(ctx, bounds.from, bounds.to, rows.length);
  const headers = ['Employee ID', 'Name', 'Department', 'Team', 'Position', 'Late Days', 'Late Minutes', 'Average Late Minutes', 'Maximum Late Minutes'];
  const data = rows.map((r) => [r.employeeId, r.fullName, r.departmentName, r.teamName, r.positionName, r.lateDays, r.lateMinutes, r.averageLateMinutes, r.maximumLateMinutes]);
  return render(`late-monthly-${query.year}-${query.month}`, headers, data, query.format);
}
