import { describe, expect, it } from 'vitest';
import { dailyAttendanceQuerySchema, dailyLateQuerySchema, employeeReportQuerySchema, employeeSearchQuerySchema, monthBounds, monthlyAttendanceQuerySchema, monthlyReportQuerySchema } from './validators.js';

describe('attendance reporting validators', () => {
  it('builds inclusive calendar bounds for February in a leap year', () => {
    const query = employeeReportQuerySchema.parse({ month: '02', year: '2028' });
    expect(monthBounds(query)).toEqual({ month: '2028-02', from: '2028-02-01', to: '2028-02-29' });
  });

  it('rejects invalid months and limits employee search results', () => {
    expect(() => employeeReportQuerySchema.parse({ month: '13', year: '2028' })).toThrow();
    expect(employeeSearchQuerySchema.parse({ search: 'Rahul', limit: '10' })).toEqual({ search: 'Rahul', limit: 10 });
    expect(() => employeeSearchQuerySchema.parse({ limit: '51' })).toThrow();
  });

  it('coerces monthly report pagination and preserves optional filters', () => {
    expect(monthlyReportQuerySchema.parse({ month: '10', year: '2026', page: '2', pageSize: '50' })).toMatchObject({
      month: '10', year: 2026, page: 2, pageSize: 50,
    });
  });

  it('parses a daily late report date as a tenant-safe DateOnly', () => {
    expect(dailyLateQuerySchema.parse({ date: '2026-10-05' }).date).toBe('2026-10-05');
    expect(() => dailyLateQuerySchema.parse({ date: 'not-a-date' })).toThrow();
  });

  it('defaults report modes to CSV and accepts only the report filters', () => {
    expect(dailyAttendanceQuerySchema.parse({ date: '2026-10-06' })).toMatchObject({ date: '2026-10-06', format: 'csv', page: 1 });
    expect(monthlyAttendanceQuerySchema.parse({ month: '10', year: '2026', format: 'xlsx' })).toMatchObject({ month: '10', year: 2026, format: 'xlsx' });
  });
});
