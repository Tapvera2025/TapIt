import { z } from 'zod';
import type { DateOnly } from '@tapcrm/contracts';
import { toDateOnly } from '../../../platform/time.js';
import { dateSchema } from '../validators.js';

const monthSchema = z.string().regex(/^(0[1-9]|1[0-2])$/, 'Expected a month from 01 to 12.');
const yearSchema = z.coerce.number().int().min(2000).max(2200);

export const employeeReportParamsSchema = z.object({ userId: z.string().uuid() });
export const employeeReportQuerySchema = z.object({ month: monthSchema, year: yearSchema });
export const employeeSearchQuerySchema = z.object({
  search: z.string().trim().max(120).default(''),
  limit: z.coerce.number().int().min(1).max(50).default(25),
});
export const monthlyReportQuerySchema = z.object({
  month: monthSchema,
  year: yearSchema,
  departmentId: z.string().uuid().optional(),
  teamId: z.string().uuid().optional(),
  positionId: z.string().uuid().optional(),
  shiftId: z.string().uuid().optional(),
  employeeId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  format: z.enum(['csv', 'xlsx']).default('csv'),
});
export const dailyAttendanceQuerySchema = z.object({
  date: dateSchema,
  shiftId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  format: z.enum(['csv', 'xlsx']).default('csv'),
});
export const monthlyAttendanceQuerySchema = z.object({
  month: monthSchema,
  year: yearSchema,
  shiftId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  format: z.enum(['csv', 'xlsx']).default('csv'),
});
export const dailyLateQuerySchema = z.object({
  date: dateSchema,
  departmentId: z.string().uuid().optional(),
  teamId: z.string().uuid().optional(),
  positionId: z.string().uuid().optional(),
  shiftId: z.string().uuid().optional(),
  employeeId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  format: z.enum(['csv', 'xlsx']).default('csv'),
});

export type EmployeeReportQuery = z.infer<typeof employeeReportQuerySchema>;
export type EmployeeSearchQuery = z.infer<typeof employeeSearchQuerySchema>;
export type MonthlyReportQuery = z.infer<typeof monthlyReportQuerySchema>;
export type DailyLateQuery = z.infer<typeof dailyLateQuerySchema>;
export type DailyAttendanceQuery = z.infer<typeof dailyAttendanceQuerySchema>;
export type MonthlyAttendanceQuery = z.infer<typeof monthlyAttendanceQuerySchema>;

export function monthBounds(query: EmployeeReportQuery): { month: string; from: DateOnly; to: DateOnly } {
  const month = `${query.year}-${query.month}`;
  const from = toDateOnly(`${month}-01`);
  const nextYear = query.month === '12' ? query.year + 1 : query.year;
  const nextMonth = query.month === '12' ? '01' : String(Number(query.month) + 1).padStart(2, '0');
  const next = new Date(Date.UTC(nextYear, Number(nextMonth) - 1, 1, 12));
  next.setUTCDate(next.getUTCDate() - 1);
  return { month, from, to: toDateOnly(next.toISOString().slice(0, 10)) };
}
