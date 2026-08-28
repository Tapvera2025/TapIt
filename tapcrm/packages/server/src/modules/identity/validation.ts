import { z } from 'zod';

export const loginSchema = z.object({
  organizationCode: z
    .string()
    .trim()
    .min(1, 'Organization code is required')
    .max(100, 'Organization code is too long'),

  accountType: z.enum(['super-admin', 'employee', 'client'], {
    errorMap: () => ({
      message: 'Account type must be super-admin, employee or client',
    }),
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

export const mfaChallengeSchema = z.object({
  mfaToken: z.string().min(1, 'MFA token is required'),
  method: z.enum(['totp', 'email-otp', 'recovery-code']),
  factorValue: z.string().min(1, 'Verification code or recovery code is required'),
});

export type MfaChallengeInput = z.infer<typeof mfaChallengeSchema>;

export const mfaConfirmSchema = z.object({
  secret: z.string().min(1, 'Secret is required'),
  code: z.string().min(6).max(6, 'Verification code must be 6 digits'),
  recoveryCodes: z.array(z.string()).min(1, 'Recovery codes are required'),
  label: z.string().max(100).optional(),
});

export type MfaConfirmInput = z.infer<typeof mfaConfirmSchema>;

export const forgotPasswordSchema = z.object({
  organizationCode: z.string().trim().min(1, 'Organization code is required'),
  accountType: z.enum(['super-admin', 'employee', 'client']),
  email: z.string().trim().email('Invalid email address'),
});

export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z.object({
  token: z.string().min(1, 'Reset token is required'),
  newPassword: z.string().min(12, 'Password must be at least 12 characters'),
});

export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z.string().min(12, 'New password must be at least 12 characters'),
});

export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const createGeofenceSchema = z.object({
  name: z.string().trim().min(1, 'Location name is required').max(100),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  radiusMetres: z.number().int().positive('Radius must be greater than zero').max(50000),
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
  userId: z.string().uuid('Invalid user ID'),
  bypassUntil: z.string().datetime().optional().nullable(),
  bypassReason: z.string().max(500).optional().nullable(),
});

export type AssignGeofenceInput = z.infer<typeof assignGeofenceSchema>;
