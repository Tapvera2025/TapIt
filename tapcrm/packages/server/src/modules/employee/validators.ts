import { z } from 'zod';

export const createEmployeeSchema = z.object({
  email: z.string().trim().email().max(320),
  fullName: z.string().trim().min(2).max(160),
  password: z.string().min(12).max(200),
  confirmPassword: z.string().min(12).max(200),
  departmentId: z.string().uuid(),
  positionId: z.string().uuid(),
  teamId: z.string().uuid().optional(),
  designationId: z.string().uuid().optional(),
  specialization: z.string().trim().max(160).optional(),
  reportsTo: z.string().uuid().nullable().optional(),
}).refine((value) => value.password === value.confirmPassword, {
  message: 'Password and confirmation must match',
  path: ['confirmPassword'],
});

export type CreateEmployeeInput = z.infer<typeof createEmployeeSchema>;
