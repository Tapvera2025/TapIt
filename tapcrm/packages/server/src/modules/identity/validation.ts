import { z } from 'zod';

export const loginSchema = z.object({
  organizationCode: z
    .string()
    .trim()
    .min(1, 'Organization code is required')
    .max(100, 'Organization code is too long')
    .regex(/^[A-Za-z0-9_-]+$/, 'Organization code contains invalid characters'),
  accountType: z.enum(['super-admin', 'employee', 'client'], {
    errorMap: () => ({ message: 'Invalid account type' }),
  }),
  email: z
    .string()
    .trim()
    .email('Invalid email address')
    .max(320, 'Email address is too long'),
  password: z.string().min(1, 'Password is required').max(1024, 'Password is too long'),
  coordinates: z
    .object({
      latitude: z.number().min(-90).max(90),
      longitude: z.number().min(-180).max(180),
      accuracyMetres: z.number().nonnegative().optional(),
    })
    .optional(),
});

export type LoginInput = z.infer<typeof loginSchema>;

export const passwordSchema = z
  .string()
  .min(12, 'Password must be at least 12 characters long')
  .max(1024, 'Password is too long');

/** Public signup is invitation completion only. Organization, position and
 * employee ID come from the signed invitation created by an authorized user. */
export const signupSchema = z
  .object({
    invitationToken: z.string().trim().min(32, 'Invitation token is required').max(256),
    fullName: z
      .string()
      .trim()
      .min(2, 'Full name must contain at least 2 characters')
      .max(200),
    contact: z
      .string()
      .trim()
      .min(7, 'Contact number is too short')
      .max(30)
      .regex(/^[+0-9()\-\s]+$/, 'Contact number contains invalid characters'),
    dateOfBirth: z.string().date('Date of birth must be YYYY-MM-DD').optional(),
    gender: z.enum(['male', 'female', 'non-binary', 'prefer-not-to-say']).optional(),
    password: passwordSchema,
    confirmPassword: z.string().min(1, 'Please confirm your password'),
  })
  .superRefine((value, ctx) => {
    if (value.password !== value.confirmPassword) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['confirmPassword'],
        message: 'Passwords do not match',
      });
    }
  });

export type SignupInput = z.infer<typeof signupSchema>;

export const mfaChallengeSchema = z.object({
  mfaToken: z.string().min(1),
  method: z.enum(['totp', 'email-otp', 'recovery-code', 'passkey']),
  factorValue: z.string().trim().min(1).max(100),
});
export type MfaChallengeInput = z.infer<typeof mfaChallengeSchema>;

export const mfaConfirmSchema = z.object({
  secret: z.string().min(1),
  code: z.string().regex(/^\d{6}$/, 'Verification code must be 6 digits'),
  recoveryCodes: z.array(z.string()).min(1),
  label: z.string().max(100).optional(),
});
export type MfaConfirmInput = z.infer<typeof mfaConfirmSchema>;

export const forgotPasswordSchema = z.object({
  organizationCode: z.string().trim().min(1),
  accountType: z.enum(['super-admin', 'employee', 'client']),
  email: z.string().trim().email(),
});
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z.object({
  token: z.string().min(1),
  newPassword: passwordSchema,
});
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: passwordSchema,
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export const verifyEmailSchema = z.object({ token: z.string().trim().min(1) });
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;

export const createGeofenceSchema = z.object({
  name: z.string().trim().min(1).max(100),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  radiusMetres: z.number().int().positive().max(50000),
});
export type CreateGeofenceInput = z.infer<typeof createGeofenceSchema>;
export const updateGeofenceSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  radiusMetres: z.number().int().positive().max(50000).optional(),
});
export type UpdateGeofenceInput = z.infer<typeof updateGeofenceSchema>;
export const assignGeofenceSchema = z.object({
  userId: z.string().uuid(),
  bypassUntil: z.string().datetime().optional().nullable(),
  bypassReason: z.string().max(500).optional().nullable(),
});
export type AssignGeofenceInput = z.infer<typeof assignGeofenceSchema>;

export const passkeyRegistrationResponseSchema = z.object({}).passthrough();
export const passkeyAuthenticationResponseSchema = z.object({}).passthrough();
export const geofenceBypassRequestSchema = z.object({
  geofenceEventId: z.string().uuid().optional(),
  reason: z.string().trim().min(3).max(1000),
  requestedUntil: z.string().datetime(),
  accuracyMetres: z.number().int().nonnegative().max(100000).optional(),
});
export const serviceAccountCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().max(1000).optional(),
  allowedActions: z.array(z.string().min(1)).min(1).max(100),
  allowedResources: z.array(z.string().min(1)).min(1).max(100),
  recordFilter: z.record(z.unknown()).optional(),
  ipAllowlist: z.array(z.string().min(1)).max(100).optional(),
  expiresAt: z.string().datetime(),
  rateLimitMinute: z.number().int().positive().max(100000).default(60),
  rateLimitDay: z.number().int().positive().max(10000000).default(10000),
});
export const mfaPasskeyOptionsSchema = z.object({ mfaToken: z.string().min(1) });
export const wfhApprovalSchema = z.object({
  userId: z.string().uuid(),
  workDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reason: z.string().trim().min(3).max(1000),
});
export const wfhRevokeSchema = z.object({
  userId: z.string().uuid(),
  workDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
