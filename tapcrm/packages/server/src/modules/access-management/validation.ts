import { z } from 'zod';

const actionSchema = z.string().trim().min(1).max(150);

const scopeSchema = z.enum([
  'own',
  'participant',
  'pool',
  'team',
  'department',
  'all-people',
]);

const stringArraySchema = z
  .array(z.string().trim().min(1).max(200))
  .max(100)
  .nullable()
  .optional();

/* ================================================================== *
 * User Override
 * ================================================================== */

export const createOverrideSchema = z.object({
  userId: z.string().uuid(),

  action: actionSchema,

  allowed: z.boolean().default(true),

  scope: scopeSchema,

  fields: stringArraySchema,

  constraints: stringArraySchema,

  reason: z.string().trim().min(1).max(1000),

  expiresAt: z.string().datetime().nullable().optional(),
});

/* ================================================================== *
 * Role Change
 * ================================================================== */

export const roleChangeRequestSchema = z.object({
  subjectUserId: z.string().uuid(),

  toPositionId: z.string().uuid(),

  reason: z.string().trim().min(1).max(1000),
});

export const decideRoleChangeSchema = z.object({
  status: z.enum(['approved', 'rejected']),

  decisionReason: z.string().trim().min(1).max(1000).optional(),
});

/* ================================================================== *
 * Approval Delegation
 * ================================================================== */

export const createApprovalDelegationSchema = z.object({
  delegateUserId: z.string().uuid(),

  startAt: z.string().datetime(),

  endAt: z.string().datetime(),

  reason: z.string().trim().min(1).max(1000),
});

export const revokeApprovalDelegationSchema = z.object({
  reason: z.string().trim().min(1).max(1000).optional(),
});

/* ================================================================== *
 * Query validation
 * ================================================================== */

export const actionQuerySchema = z.object({
  action: actionSchema,
});
