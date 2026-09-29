import { z } from 'zod';
import { toDateOnly } from '../../platform/time.js';

// ED-3 — Employee ID format. Uppercase, alphanumeric with hyphens, 1–50
// chars, starting with an alphanumeric. Matches the DB CHECK constraint;
// keeping the two in sync is deliberate so validation errors surface at
// 422 rather than as a 500 from a constraint violation.
const employeeIdFormat = /^[A-Z0-9][A-Z0-9-]{0,49}$/;

const date = z.string().transform((value, ctx) => {
  try {
    return toDateOnly(value);
  } catch {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Expected a date, YYYY-MM-DD' });
    return z.NEVER;
  }
});

export const createEmployeeSchema = z.object({
  employeeId: z
    .string()
    .trim()
    .transform((value) => value.toUpperCase())
    .refine((value) => employeeIdFormat.test(value), {
      message: 'Employee ID must be uppercase alphanumeric with hyphens (max 50 chars)',
    })
    .optional(),
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
  /** The first day they work here (§8.6). */
  joiningDate: date.optional(),
}).refine((value) => value.password === value.confirmPassword, {
  message: 'Password and confirmation must match',
  path: ['confirmPassword'],
});

export type CreateEmployeeInput = z.infer<typeof createEmployeeSchema>;

/**
 * PATCH /api/users/:id. For now it changes the employment window only; the
 * other profile fields join this schema with the employee edit screen.
 * `null` clears a date.
 */
export const updateEmployeeSchema = z
  .object({
    joiningDate: date.nullable(),
    /** The last day they work here, inclusive. */
    leavingDate: date.nullable(),
  })
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: 'Nothing to change' });

export type UpdateEmployeeInput = z.infer<typeof updateEmployeeSchema>;

export const resetPasswordSchema = z.object({
  password: z.string().min(12).max(200),
});
