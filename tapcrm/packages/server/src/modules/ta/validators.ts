import { z } from 'zod';

function validCalendarDate(value: string, message: string): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  )
    throw new Error(message);
  return value;
}

export const month = z
  .string()
  .refine(
    (value) => /^\d{4}-(0[1-9]|1[0-2])-01$/.test(value),
    'Invalid TA month. Use YYYY-MM-01.',
  );
export const date = z.string().superRefine((value, ctx) => {
  try {
    validCalendarDate(value, 'Invalid TA date.');
  } catch (error) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: (error as Error).message });
  }
});
const amountPaise = z.coerce
  .number({ invalid_type_error: 'Daily TA amount is required.' })
  .int('Daily TA amount must be in whole paise.')
  .positive('Daily TA amount must be greater than zero.')
  .max(Number.MAX_SAFE_INTEGER, 'Daily TA amount is too large.');

export const assignmentSchema = z
  .object({
    departmentId: z.string().uuid('Department is required.'),
    employeeId: z.string().uuid('Employee is required.'),
    taMonth: month,
    dailyAmountPaise: amountPaise,
    effectiveFrom: date,
    effectiveTo: date.nullable().optional(),
    remarks: z
      .string()
      .trim()
      .max(500, 'Remarks cannot exceed 500 characters.')
      .optional(),
  })
  .superRefine((value, ctx) => {
    if (value.effectiveTo && value.effectiveFrom > value.effectiveTo)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['effectiveTo'],
        message: 'Effective To cannot be before Effective From.',
      });
    const monthEnd = new Date(`${value.taMonth}T00:00:00.000Z`);
    monthEnd.setUTCMonth(monthEnd.getUTCMonth() + 1);
    monthEnd.setUTCDate(0);
    const from = new Date(`${value.effectiveFrom}T00:00:00.000Z`);
    const to = value.effectiveTo ? new Date(`${value.effectiveTo}T00:00:00.000Z`) : null;
    if (from < new Date(`${value.taMonth}T00:00:00.000Z`) || from > monthEnd)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['effectiveFrom'],
        message: 'Effective From must belong to the selected TA month.',
      });
    if (to && (to < new Date(`${value.taMonth}T00:00:00.000Z`) || to > monthEnd))
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['effectiveTo'],
        message: 'Effective To must belong to the selected TA month.',
      });
  });

export const listSchema = z.object({
  taMonth: month,
  departmentId: z.string().uuid().optional(),
  search: z.string().trim().max(100).optional(),
  status: z.enum(['all', 'draft', 'sent']).default('all'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export const recalculateSchema = z.object({
  taMonth: month,
  assignmentIds: z.array(z.string().uuid()).min(1, 'Select at least one TA assignment.'),
});
export const sendSchema = z.object({
  statementIds: z.array(z.string().uuid()).min(1, 'Select at least one TA statement.'),
});
export const mySchema = z.object({ taMonth: month });
export type AssignmentBody = z.infer<typeof assignmentSchema>;
export type ListQuery = z.infer<typeof listSchema>;
