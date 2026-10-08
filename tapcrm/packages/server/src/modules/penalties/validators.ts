import { z } from 'zod';
import { PENALTY_TYPES } from './types.js';

const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a valid date in YYYY-MM-DD format.')
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, 'Use a valid calendar date.');
const month = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])-01$/, 'Use a valid payroll month in YYYY-MM format.');
const paise = z.coerce
  .number({ invalid_type_error: 'Amount must be a number.' })
  .int('Amount must be a whole number of paise.')
  .positive('Amount must be greater than zero.')
  .max(Number.MAX_SAFE_INTEGER, 'Amount is too large.');

export const createPenaltySchema = z.object({
  employeeId: z.string().uuid('Select a valid employee.'),
  penaltyType: z.enum(PENALTY_TYPES),
  amountPaise: paise,
  penaltyDate: dateOnly,
  payrollPeriod: month,
  remarks: z
    .string()
    .trim()
    .min(1, 'Remarks are required.')
    .max(2000, 'Remarks cannot exceed 2,000 characters.'),
});

export const cancelPenaltySchema = z.object({
  cancellationReason: z
    .string()
    .trim()
    .min(3, 'Cancellation reason must be at least 3 characters.')
    .max(2000, 'Cancellation reason cannot exceed 2,000 characters.'),
});

export const listPenaltySchema = z.object({
  search: z.string().trim().max(100).optional(),
  penaltyType: z.enum(PENALTY_TYPES).optional(),
  status: z.enum(['active', 'cancelled', 'all']).default('active'),
  payrollStatus: z.enum(['pending', 'processed', 'recovered', 'all']).default('all'),
  payrollPeriod: month.optional(),
  dateFrom: dateOnly.optional(),
  dateTo: dateOnly.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
}).superRefine((value, ctx) => {
  if (value.dateFrom && value.dateTo && value.dateFrom > value.dateTo) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['dateFrom'],
      message: 'Date From cannot be later than Date To.',
    });
  }
});

export type CreatePenaltyBody = z.infer<typeof createPenaltySchema>;
export type CancelPenaltyBody = z.infer<typeof cancelPenaltySchema>;
export type ListPenaltyQuery = z.infer<typeof listPenaltySchema>;
