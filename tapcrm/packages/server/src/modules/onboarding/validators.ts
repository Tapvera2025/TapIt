import { z } from 'zod';

export const completeStepSchema = z.object({
  notes: z.string().trim().max(1000).optional(),
});

export type CompleteStepInput = z.infer<typeof completeStepSchema>;

export const listWorkflowsQuerySchema = z.object({
  status: z.enum(['in_progress', 'completed', 'cancelled']).optional(),
  employeeId: z.string().uuid().optional(),
});

export type ListWorkflowsQuery = z.infer<typeof listWorkflowsQuerySchema>;

export const createWorkflowSchema = z
  .object({
    employeeId: z.string().uuid(),
    startDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD')
      .optional(),
    managerId: z.string().uuid().nullable().optional(),
  })
  .strict();

export type CreateWorkflowInput = z.infer<typeof createWorkflowSchema>;

