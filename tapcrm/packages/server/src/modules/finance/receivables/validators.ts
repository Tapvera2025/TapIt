import { z } from 'zod';

const reason = z.string().trim().min(3).max(1000);
const uuid = z.string().uuid();

export const dunningSchema = z.object({ reason });
export const dunningScheduleSchema = z.object({
  clientId: uuid,
  enabled: z.boolean().default(true),
  cadenceDays: z.number().int().min(1).max(365),
  nextRunAt: z.string().datetime(),
  reason,
});
export const writeOffSchema = z.object({
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/),
  reason,
});
export const disputeSchema = z.object({
  holdCollections: z.boolean().default(true),
  reason,
});
export const disputeResolutionSchema = z.object({
  status: z.enum(['under_review', 'resolved', 'rejected']),
  resolution: reason,
});
export const promiseSchema = z.object({
  promisedAmount: z.string().regex(/^\d+(\.\d{1,2})?$/),
  promisedFor: z.string().datetime(),
  reason,
});
export const promiseResolutionSchema = z.object({
  status: z.enum(['kept', 'broken', 'cancelled']),
  reason,
});
export const collectionTaskSchema = z.object({
  clientId: uuid,
  invoiceId: uuid.optional(),
  assignedTo: uuid.optional(),
  taskType: z.enum(['reminder', 'call', 'review', 'promise_follow_up']),
  dueAt: z.string().datetime(),
  title: z.string().trim().min(1).max(200),
  reason,
});
export const taskStatusSchema = z.object({
  status: z.enum(['in_progress', 'completed', 'cancelled']),
  reason,
});

export type DunningScheduleInput = z.infer<typeof dunningScheduleSchema>;
export type WriteOffInput = z.infer<typeof writeOffSchema>;
export type DisputeInput = z.infer<typeof disputeSchema>;
export type DisputeResolutionInput = z.infer<typeof disputeResolutionSchema>;
export type PromiseInput = z.infer<typeof promiseSchema>;
export type PromiseResolutionInput = z.infer<typeof promiseResolutionSchema>;
export type CollectionTaskInput = z.infer<typeof collectionTaskSchema>;
export type TaskStatusInput = z.infer<typeof taskStatusSchema>;
