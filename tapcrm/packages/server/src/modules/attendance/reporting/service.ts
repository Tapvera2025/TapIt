import { visibilityFilter } from '@tapcrm/authz';
import type { RequestContext } from '../../../platform/dal/context.js';
import { db } from '../../../platform/dal/db.js';
import { AttendanceNotFoundError } from '../errors.js';
import { requestExport } from '../export.js';
import * as repo from './repository.js';
import type { MonthlyReportFilter } from './repository.js';
import { monthBounds, type DailyAttendanceQuery, type DailyLateQuery, type EmployeeReportQuery, type EmployeeSearchQuery, type MonthlyAttendanceQuery, type MonthlyReportQuery } from './validators.js';

function iso(value: Date | null): string | null { return value?.toISOString() ?? null; }

function dayView(row: repo.EmployeeReportDayRow) {
  const shift = row.shift as { kind?: string; start?: string | null; end?: string | null } | null;
  return {
    date: row.workDate, status: row.status, dayType: row.dayType,
    units: { present: row.presentUnits, paidLeave: row.paidLeaveUnits, unpaidLeave: row.unpaidLeaveUnits, absent: row.absentUnits, holiday: row.holidayUnits },
    minutes: { worked: row.workedMinutes, break: row.breakMinutes, late: row.lateMinutes, overtime: row.overtimeMinutes },
    arrivalAt: iso(row.arrivalAt), departureAt: iso(row.departureAt), isWfh: row.isWfh, flags: row.flags,
    shift: { kind: shift?.kind ?? null, start: shift?.start ?? null, end: shift?.end ?? null, source: row.shiftSource },
    recalculating: row.recalculating,
  };
}

export async function searchReportEmployees(ctx: RequestContext, query: EmployeeSearchQuery) {
  const visibility = await visibilityFilter(ctx, 'attendance:view', 'attendanceRecord');
  return db.transaction(ctx, (tx) => repo.searchEmployees(tx, visibility, query.search, query.limit));
}

export async function getEmployeeReport(ctx: RequestContext, userId: string, query: EmployeeReportQuery) {
  const visibility = await visibilityFilter(ctx, 'attendance:view', 'attendanceRecord');
  const bounds = monthBounds(query);
  return db.transaction(ctx, async (tx) => {
    const employee = await repo.findEmployee(tx, userId, visibility);
    if (employee === null) throw new AttendanceNotFoundError('ATTENDANCE_EMPLOYEE_NOT_FOUND', 'Employee not found.');
    const [summary, days] = await Promise.all([
      repo.findMonthlySummary(tx, userId, bounds.month),
      repo.findMonthlyDays(tx, userId, bounds.from, bounds.to),
    ]);
    return { employee, month: bounds.month, summary, records: days.map(dayView) };
  });
}

export async function getMonthlyReport(ctx: RequestContext, query: MonthlyReportQuery) {
  const visibility = await visibilityFilter(ctx, 'attendance:view', 'attendanceRecord');
  const bounds = monthBounds(query);
  const filter: MonthlyReportFilter = {};
  if (query.departmentId) filter.departmentId = query.departmentId;
  if (query.teamId) filter.teamId = query.teamId;
  if (query.positionId) filter.positionId = query.positionId;
  if (query.shiftId) filter.shiftId = query.shiftId;
  if (query.employeeId) filter.employeeId = query.employeeId;
  return db.transaction(ctx, async (tx) => {
    const [total, rows] = await Promise.all([
      repo.countMonthlyEmployees(tx, visibility, filter, bounds.from, bounds.to),
      repo.listMonthlyEmployees(tx, visibility, filter, bounds.from, bounds.to, query.page, query.pageSize),
    ]);
    return { month: bounds.month, rows, page: query.page, pageSize: query.pageSize, total, totalPages: Math.max(1, Math.ceil(total / query.pageSize)) };
  });
}

export async function exportMonthlyReport(ctx: RequestContext, query: MonthlyReportQuery) {
  const visibility = await visibilityFilter(ctx, 'attendance:export', 'attendanceRecord');
  const bounds = monthBounds(query);
  const filter: repo.MonthlyReportFilter = {};
  if (query.departmentId) filter.departmentId = query.departmentId;
  if (query.teamId) filter.teamId = query.teamId;
  if (query.positionId) filter.positionId = query.positionId;
  if (query.shiftId) filter.shiftId = query.shiftId;
  if (query.employeeId) filter.employeeId = query.employeeId;
  const userIds = await db.transaction(ctx, (tx) => repo.listMonthlyEmployeeIds(tx, visibility, filter, bounds.from, bounds.to));
  return requestExport(ctx, { from: bounds.from, to: bounds.to, userIds, format: query.format });
}

function reportFilter(query: { departmentId?: string | undefined; teamId?: string | undefined; positionId?: string | undefined; shiftId?: string | undefined; employeeId?: string | undefined }): repo.MonthlyReportFilter {
  const filter: repo.MonthlyReportFilter = {};
  if (query.departmentId) filter.departmentId = query.departmentId;
  if (query.teamId) filter.teamId = query.teamId;
  if (query.positionId) filter.positionId = query.positionId;
  if (query.shiftId) filter.shiftId = query.shiftId;
  if (query.employeeId) filter.employeeId = query.employeeId;
  return filter;
}

export async function getDailyLateReport(ctx: RequestContext, query: DailyLateQuery) {
  const visibility = await visibilityFilter(ctx, 'attendance:view', 'attendanceRecord');
  const filter = reportFilter(query);
  return db.transaction(ctx, async (tx) => {
    const [total, rows] = await Promise.all([
      repo.countDailyLate(tx, visibility, filter, query.date),
      repo.listDailyLate(tx, visibility, filter, query.date, query.page, query.pageSize),
    ]);
    return { date: query.date, rows, page: query.page, pageSize: query.pageSize, total, totalPages: Math.max(1, Math.ceil(total / query.pageSize)) };
  });
}

export async function getDailyAttendanceReport(ctx: RequestContext, query: DailyAttendanceQuery) {
  const visibility = await visibilityFilter(ctx, 'attendance:view', 'attendanceRecord');
  return db.transaction(ctx, async (tx) => {
    const [total, rows] = await Promise.all([
      repo.countDailyAttendance(tx, visibility, query.date, query.shiftId),
      repo.listDailyAttendance(tx, visibility, query.date, query.shiftId, query.page, query.pageSize),
    ]);
    return { date: query.date, rows, page: query.page, pageSize: query.pageSize, total, totalPages: Math.max(1, Math.ceil(total / query.pageSize)) };
  });
}

export async function getMonthlyAttendanceReport(ctx: RequestContext, query: MonthlyAttendanceQuery) {
  const visibility = await visibilityFilter(ctx, 'attendance:view', 'attendanceRecord');
  const bounds = monthBounds(query);
  const filter: repo.MonthlyReportFilter = {};
  if (query.shiftId) filter.shiftId = query.shiftId;
  return db.transaction(ctx, async (tx) => {
    const [total, rows] = await Promise.all([
      repo.countMonthlyEmployees(tx, visibility, filter, bounds.from, bounds.to),
      repo.listMonthlyEmployees(tx, visibility, filter, bounds.from, bounds.to, query.page, query.pageSize),
    ]);
    return { month: bounds.month, rows, page: query.page, pageSize: query.pageSize, total, totalPages: Math.max(1, Math.ceil(total / query.pageSize)) };
  });
}

export async function exportDailyAttendanceReport(ctx: RequestContext, query: DailyAttendanceQuery) {
  const visibility = await visibilityFilter(ctx, 'attendance:export', 'attendanceRecord');
  const userIds = await db.transaction(ctx, (tx) => repo.listDailyAttendanceEmployeeIds(tx, visibility, query.date, query.shiftId));
  return requestExport(ctx, { from: query.date, to: query.date, userIds, format: query.format });
}

export async function getMonthlyLateReport(ctx: RequestContext, query: MonthlyReportQuery) {
  const visibility = await visibilityFilter(ctx, 'attendance:view', 'attendanceRecord');
  const bounds = monthBounds(query);
  const filter = reportFilter(query);
  return db.transaction(ctx, async (tx) => {
    const [total, rows] = await Promise.all([
      repo.countMonthlyLate(tx, visibility, filter, bounds.from, bounds.to),
      repo.listMonthlyLate(tx, visibility, filter, bounds.from, bounds.to, query.page, query.pageSize),
    ]);
    return { month: bounds.month, rows, page: query.page, pageSize: query.pageSize, total, totalPages: Math.max(1, Math.ceil(total / query.pageSize)) };
  });
}

export async function exportDailyLateReport(ctx: RequestContext, query: DailyLateQuery) {
  const visibility = await visibilityFilter(ctx, 'attendance:export', 'attendanceRecord');
  const userIds = await db.transaction(ctx, (tx) => repo.listDailyLateEmployeeIds(tx, visibility, reportFilter(query), query.date));
  return requestExport(ctx, { from: query.date, to: query.date, userIds, format: query.format });
}

export async function exportMonthlyLateReport(ctx: RequestContext, query: MonthlyReportQuery) {
  const visibility = await visibilityFilter(ctx, 'attendance:export', 'attendanceRecord');
  const bounds = monthBounds(query);
  const userIds = await db.transaction(ctx, (tx) => repo.listMonthlyLateEmployeeIds(tx, visibility, reportFilter(query), bounds.from, bounds.to));
  return requestExport(ctx, { from: bounds.from, to: bounds.to, userIds, format: query.format });
}
