import { z } from 'zod';
import type { HolidaySubtype } from '@tapcrm/contracts';
import { toDateOnly } from '../../platform/time.js';

const date = z.string().transform((value, ctx) => {
  try {
    return toDateOnly(value);
  } catch {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Expected a date, YYYY-MM-DD' });
    return z.NEVER;
  }
});

const weekday = z.number().int().min(1).max(7);
const weekOfMonth = z.number().int().min(1).max(5);

const recurrenceSchema = z.object({
  weekdays: z.array(weekday).min(1),
  weeksOfMonth: z.array(weekOfMonth).min(1).optional(),
});

const departmentScope = z.object({
  departmentId: z.string().uuid(),
  shiftId: z.null().optional(),
});
const shiftScope = z.object({
  departmentId: z.null().optional(),
  shiftId: z.string().uuid(),
});
const scopeRow = z.union([departmentScope, shiftScope]).transform((s) => ({
  departmentId: 'departmentId' in s ? s.departmentId ?? null : null,
  shiftId: 'shiftId' in s ? s.shiftId ?? null : null,
}));

export const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  type: z.enum(['national', 'regional', 'optional', 'week-off']),
  holidayDate: date.nullable().default(null),
  recurrence: recurrenceSchema.nullable().default(null),
  effectiveFrom: date.nullable().default(null),
  effectiveTo: date.nullable().default(null),
  scopes: z.array(scopeRow).default([]),
});

export const reviseSchema = z.union([
  z.object({ status: z.enum(['active', 'withdrawn']) }).strict(),
  z.object({ scopes: z.array(scopeRow) }).strict(),
]);

export const listQuerySchema = z.object({
  from: date.optional(),
  to: date.optional(),
});

export type CreateBody = z.infer<typeof createSchema>;
export type ReviseBody = z.infer<typeof reviseSchema>;
export type ListQuery = z.infer<typeof listQuerySchema>;
export type ScopeRow = z.infer<typeof scopeRow>;
export type HolidayType = HolidaySubtype;
