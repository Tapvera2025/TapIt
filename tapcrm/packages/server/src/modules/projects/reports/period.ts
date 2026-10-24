import { z } from 'zod';
import { ident, sql, type SqlQuery } from '../../../platform/dal/sql.js';

export const reportPeriodSchema = z.coerce.number().int().refine((value): value is 7 | 30 | 90 => value === 7 || value === 30 || value === 90).default(30);
export type ReportPeriod = 7 | 30 | 90;

/** Safe, shared date-window predicate for project report resources. */
export function withinReportPeriod(column: string, period: ReportPeriod): SqlQuery {
  const [table, field] = column.split('.');
  if (!table || !field) throw new Error(`Invalid report date column: ${column}`);
  return sql`${ident(table)}.${ident(field)} >= now() - (${period} * interval '1 day')`;
}
