import { z } from 'zod';

export const createEmployeeSchema = z.object({
  email: z.string().trim().email().max(320),
  fullName: z.string().trim().min(2).max(160),
  departmentId: z.string().uuid(),
  positionId: z.string().uuid(),
  teamId: z.string().uuid().optional(),
  designationId: z.string().uuid().optional(),
  specialization: z.string().trim().max(160).optional(),
  reportsTo: z.string().uuid().nullable().optional(),
});

export type CreateEmployeeInput = z.infer<typeof createEmployeeSchema>;
