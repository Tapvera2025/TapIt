import { z } from 'zod';

const month = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])-01$/, 'Use a valid month in YYYY-MM format.');
const paise = z.coerce
  .number({ invalid_type_error: 'Amount must be a number.' })
  .int('Amount must be a whole number of paise.')
  .positive('Amount must be greater than zero.')
  .max(Number.MAX_SAFE_INTEGER, 'Amount is too large.');
export const requestAdvanceSchema = z.object({
  amountPaise: paise,
  requestedForPeriod: month,
  reason: z
    .string()
    .trim()
    .min(1, 'Reason is required.')
    .max(2000, 'Reason cannot exceed 2,000 characters.'),
});
export const approveAdvanceSchema = z.object({
  approvedAmountPaise: paise,
  approvalNote: z.string().trim().max(2000).optional(),
});
export const rejectAdvanceSchema = z.object({
  rejectionReason: z
    .string()
    .trim()
    .min(1, 'Rejection reason is required.')
    .max(2000, 'Rejection reason cannot exceed 2,000 characters.'),
});
export const manualAdvanceSchema = requestAdvanceSchema.extend({
  employeeId: z.string().uuid(),
});
export const deductionSchema = z.object({
  payrollPeriod: month,
  scheduledAmountPaise: paise,
});
export const listAdvanceSchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected', 'all']).default('all'),
  search: z.string().trim().max(100).optional(),
  month: month.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export const listDeductionSchema = z.object({
  status: z.enum(['pending', 'partial', 'completed', 'cancelled', 'all']).default('all'),
  search: z.string().trim().max(100).optional(),
  month: month.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type ListAdvanceQuery = z.infer<typeof listAdvanceSchema>;
export type ListDeductionQuery = z.infer<typeof listDeductionSchema>;
export type RequestAdvanceBody = z.infer<typeof requestAdvanceSchema>;
export type ApproveAdvanceBody = z.infer<typeof approveAdvanceSchema>;
export type RejectAdvanceBody = z.infer<typeof rejectAdvanceSchema>;
export type ManualAdvanceBody = z.infer<typeof manualAdvanceSchema>;
export type DeductionBody = z.infer<typeof deductionSchema>;
