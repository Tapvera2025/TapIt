import { z } from 'zod';

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD');
const half = z.enum(['full', 'first', 'second']).default('full');

export const submitLeaveSchema = z.object({
  leaveTypeId: z.string().uuid(),
  fromDate: dateOnly, toDate: dateOnly,
  fromHalf: half, toHalf: half,
  reason: z.string().min(1).max(2000),
});
export type SubmitLeaveBody = z.infer<typeof submitLeaveSchema>;

export const submitWfhSchema = z.object({
  leaveTypeId: z.string().uuid(),
  fromDate: dateOnly, toDate: dateOnly,
  reason: z.string().min(1).max(2000),
});
export type SubmitWfhBody = z.infer<typeof submitWfhSchema>;

export const submitStandingWfhSchema = z.object({
  leaveTypeId: z.string().uuid(),
  fromDate: dateOnly,
  recurrenceEnd: dateOnly,
  reason: z.string().min(1).max(2000),
});
export type SubmitStandingWfhBody = z.infer<typeof submitStandingWfhSchema>;

export const decideSchema = z.object({
  decision: z.enum(['approved', 'rejected', 'revoked']),
  decisionNote: z.string().max(2000).optional(),
});
export type DecideBody = z.infer<typeof decideSchema>;

export const createLeaveTypeSchema = z.object({
  code: z.string().min(1).max(50),
  name: z.string().min(1).max(100),
  kind: z.enum(['absence', 'attendance-mode']),
  accrualDays: z.number().int().min(0).default(0),
  enforcement: z.boolean().default(false),
  paidLeave: z.boolean().default(true),
});
export type CreateLeaveTypeBody = z.infer<typeof createLeaveTypeSchema>;

export const updateLeaveTypeSchema = createLeaveTypeSchema.partial()
  .extend({ isActive: z.boolean().optional() });
export type UpdateLeaveTypeBody = z.infer<typeof updateLeaveTypeSchema>;

export const listQuerySchema = z.object({
  userId: z.string().uuid().optional(),
  status: z.enum(['pending', 'acknowledged', 'approved', 'rejected', 'cancelled']).optional(),
  fromDate: dateOnly.optional(),
  toDate: dateOnly.optional(),
  after: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListQuery = z.infer<typeof listQuerySchema>;

export const balanceQuerySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
});
export type BalanceQuery = z.infer<typeof balanceQuerySchema>;

export const calendarQuerySchema = z.object({
  userId: z.string().uuid().optional(),
  year: z.coerce.number().int(),
  month: z.coerce.number().int().min(1).max(12),
});
export type CalendarQuery = z.infer<typeof calendarQuerySchema>;
