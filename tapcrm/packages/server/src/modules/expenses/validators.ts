import { z } from 'zod';
import { EXPENSE_CATEGORIES } from './types.js';

const dateOnly = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expense date must use YYYY-MM-DD format.')
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, 'Enter a valid expense date.')
  .refine((value) => value <= new Date().toISOString().slice(0, 10), 'Expense date cannot be in the future.');

const attachment = z.object({
  originalFilename: z.string().trim().min(1, 'Receipt filename is required.').max(255),
  mimeType: z.string().trim().min(1, 'Receipt type is required.'),
  data: z.string().min(1, 'Receipt data is required.'),
});

const common = z.object({
  expenseDate: dateOnly,
  amountPaise: z.coerce.number({ invalid_type_error: 'Enter a valid expense amount.' })
    .int('Expense amount must have at most 2 decimal places.')
    .positive('Expense amount must be greater than zero.')
    .max(Number.MAX_SAFE_INTEGER, 'Expense amount is too large.'),
  category: z.enum(EXPENSE_CATEGORIES),
  remarks: z.string().trim().min(3, 'Remarks must be at least 3 characters.').max(500, 'Remarks cannot exceed 500 characters.'),
  attachments: z.array(attachment).max(3, 'You can upload a maximum of 3 receipts.').default([]),
});

export const createExpenseSchema = common;
export const updateExpenseSchema = common.partial().refine((value) => Object.keys(value).length > 0, 'Provide at least one expense field to update.');
export const rejectExpenseSchema = z.object({
  rejectionReason: z.string().trim().min(3, 'Rejection reason must be at least 3 characters.').max(500, 'Rejection reason cannot exceed 500 characters.'),
});
export const expenseListSchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected', 'all']).default('all'),
  search: z.string().trim().max(100).optional(),
  category: z.enum(EXPENSE_CATEGORIES).optional(),
  dateFrom: dateOnly.optional(),
  dateTo: dateOnly.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
}).superRefine((value, ctx) => {
  if (value.dateFrom && value.dateTo && value.dateFrom > value.dateTo)
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['dateFrom'], message: 'Date From cannot be later than Date To.' });
});
export type CreateExpenseBody = z.infer<typeof createExpenseSchema>;
export type UpdateExpenseBody = z.infer<typeof updateExpenseSchema>;
export type RejectExpenseBody = z.infer<typeof rejectExpenseSchema>;
export type ExpenseListQuery = z.infer<typeof expenseListSchema>;
