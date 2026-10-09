import { route } from '../../../platform/http/route.js';
import { getDailyAttendanceReport, getDailyLateReport, getEmployeeReport, getMonthlyAttendanceReport, getMonthlyLateReport, searchReportEmployees } from './service.js';
import { exportDailyAttendance, exportDailyLate, exportMonthlyAttendance, exportMonthlyLate } from './direct-export.js';
import { dailyAttendanceQuerySchema, dailyLateQuerySchema, employeeReportParamsSchema, employeeReportQuerySchema, employeeSearchQuerySchema, monthlyAttendanceQuerySchema, monthlyReportQuerySchema } from './validators.js';

export function registerAttendanceReportingRoutes(): void {
  route({
    method: 'GET', path: '/api/attendance/reports/daily', action: 'attendance:view', module: 'attendance',
    handler: async ({ ctx, query }) => getDailyAttendanceReport(ctx, dailyAttendanceQuerySchema.parse(query)),
  });
  route({
    method: 'POST', path: '/api/attendance/reports/daily/export', action: 'attendance:export', module: 'attendance',
    handler: async ({ ctx, query, res }) => { const file = await exportDailyAttendance(ctx, dailyAttendanceQuerySchema.parse(query)); res.setHeader('Content-Type', file.contentType); res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`); res.send(file.body); return null; },
  });
  route({
    method: 'GET', path: '/api/attendance/reports/monthly', action: 'attendance:view', module: 'attendance',
    handler: async ({ ctx, query }) => getMonthlyAttendanceReport(ctx, monthlyAttendanceQuerySchema.parse(query)),
  });
  route({
    method: 'GET', path: '/api/attendance/reports/late/daily', action: 'attendance:view', module: 'attendance',
    handler: async ({ ctx, query }) => getDailyLateReport(ctx, dailyLateQuerySchema.parse(query)),
  });
  route({
    method: 'GET', path: '/api/attendance/reports/late/monthly', action: 'attendance:view', module: 'attendance',
    handler: async ({ ctx, query }) => getMonthlyLateReport(ctx, monthlyReportQuerySchema.parse(query)),
  });
  route({
    method: 'POST', path: '/api/attendance/reports/late/daily/export', action: 'attendance:export', module: 'attendance',
    handler: async ({ ctx, query, res }) => { const file = await exportDailyLate(ctx, dailyLateQuerySchema.parse(query)); res.setHeader('Content-Type', file.contentType); res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`); res.send(file.body); return null; },
  });
  route({
    method: 'POST', path: '/api/attendance/reports/late/monthly/export', action: 'attendance:export', module: 'attendance',
    handler: async ({ ctx, query, res }) => { const file = await exportMonthlyLate(ctx, monthlyReportQuerySchema.parse(query)); res.setHeader('Content-Type', file.contentType); res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`); res.send(file.body); return null; },
  });
  route({
    method: 'POST', path: '/api/attendance/reports/monthly/export', action: 'attendance:export', module: 'attendance',
    handler: async ({ ctx, query, res }) => { const file = await exportMonthlyAttendance(ctx, monthlyAttendanceQuerySchema.parse(query)); res.setHeader('Content-Type', file.contentType); res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`); res.send(file.body); return null; },
  });
  route({
    method: 'GET', path: '/api/attendance/reports/employees', action: 'attendance:view', module: 'attendance',
    handler: async ({ ctx, query }) => searchReportEmployees(ctx, employeeSearchQuerySchema.parse(query)),
  });
  route({
    method: 'GET', path: '/api/attendance/reports/employee/:userId', action: 'attendance:view', module: 'attendance',
    handler: async ({ ctx, params, query }) => getEmployeeReport(ctx, employeeReportParamsSchema.parse(params).userId, employeeReportQuerySchema.parse(query)),
  });
}
