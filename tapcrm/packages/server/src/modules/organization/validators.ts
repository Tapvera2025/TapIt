import { z } from 'zod';

const departmentKind = z.enum(['support', 'delivery']);
const departmentStatus = z.enum(['active', 'inactive']);
const teamKind = z.enum(['sales-team', 'sales-pool', 'dev-subteam']);
const positionStatus = z.enum(['active', 'inactive']);
const designationStatus = z.enum(['active', 'inactive']);

export const createDepartmentSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(
      /^[a-z0-9][a-z0-9-]*$/,
      'Code must use lowercase letters, numbers, and hyphens',
    ),
  name: z.string().trim().min(1).max(160),
  kind: departmentKind,
  status: departmentStatus.optional().default('active'),
});

export const updateDepartmentSchema = z
  .object({
    name: z.string().trim().min(1).max(160).optional(),
    status: departmentStatus.optional(),
  })
  .refine((value) => value.name !== undefined || value.status !== undefined, {
    message: 'At least one mutable department field is required',
  });

export const createTeamSchema = z.object({
  departmentId: z.string().uuid(),
  kind: teamKind,
  name: z.string().trim().min(1).max(160),
  leadUserId: z.string().uuid().nullable().optional().default(null),
  parentTeamId: z.string().uuid().nullable().optional(),
  sharedVisibility: z.boolean().optional().default(false),
});

export const updateTeamSchema = z
  .object({
    departmentId: z.string().uuid().optional(),
    kind: teamKind.optional(),
    name: z.string().trim().min(1).max(160).optional(),
    leadUserId: z.string().uuid().nullable().optional(),
    parentTeamId: z.string().uuid().nullable().optional(),
    sharedVisibility: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one team field is required',
  });

export const addTeamMemberSchema = z.object({
  userId: z.string().uuid(),
});

export const createDesignationSchema = z.object({
  name: z.string().trim().min(1).max(160),
  specializations: z
    .array(z.string().trim().min(1).max(160))
    .max(50)
    .optional()
    .default([]),
});

export const updateDesignationSchema = z
  .object({
    name: z.string().trim().min(1).max(160).optional(),
    specializations: z.array(z.string().trim().min(1).max(160)).max(50).optional(),
    status: designationStatus.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one designation field is required',
  });

export const createPositionSchema = z.object({
  departmentId: z.string().uuid(),
  code: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(
      /^[a-z0-9][a-z0-9-]*$/,
      'Code must use lowercase letters, numbers, and hyphens',
    ),
  name: z.string().trim().min(1).max(160),
  organizationalLevel: z.number().int().min(1).max(100),
  parentPositionId: z.string().uuid(),
  status: positionStatus.optional().default('active'),
  maxDealValue: z.number().nonnegative().nullable().optional(),
  maxDiscountPercent: z.number().min(0).max(100).nullable().optional(),
  allowsCustomTerms: z.boolean().optional().default(false),
  confirmImpact: z.boolean().optional().default(false),
});

export const updatePositionSchema = z
  .object({
    departmentId: z.string().uuid().optional(),
    name: z.string().trim().min(1).max(160).optional(),
    organizationalLevel: z.number().int().min(1).max(100).optional(),
    parentPositionId: z.string().uuid().nullable().optional(),
    status: positionStatus.optional(),
    maxDealValue: z.number().nonnegative().nullable().optional(),
    maxDiscountPercent: z.number().min(0).max(100).nullable().optional(),
    allowsCustomTerms: z.boolean().optional(),
    confirmImpact: z.boolean().optional().default(false),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one position field is required',
  });

const positionPolicySchema = z.object({
  action: z.string().min(1),
  allowed: z.boolean(),
  scope: z.enum(['own', 'participant', 'pool', 'team', 'department', 'all-people']),
  fields: z.array(z.string().min(1)).max(100).optional(),
  constraints: z.array(z.string().min(1)).max(100).optional(),
});

export const updatePositionPoliciesSchema = z
  .object({
    policies: z.array(positionPolicySchema).max(200),
  })
  .refine(
    (value) =>
      new Set(value.policies.map((policy) => policy.action)).size ===
      value.policies.length,
    {
      message: 'Each action may appear only once in a position policy set',
    },
  );

export const managerReassignmentSchema = z.object({
  managerUserId: z.string().uuid().nullable(),
  operation: z.enum(['individual', 'subtree']).optional().default('subtree'),
});

export const confirmManagerReassignmentSchema = managerReassignmentSchema.extend({
  confirm: z.literal(true),
});

export type CreateDepartmentInput = z.infer<typeof createDepartmentSchema>;
export type UpdateDepartmentInput = z.infer<typeof updateDepartmentSchema>;
export type CreateTeamInput = z.infer<typeof createTeamSchema>;
export type UpdateTeamInput = z.infer<typeof updateTeamSchema>;
export type AddTeamMemberInput = z.infer<typeof addTeamMemberSchema>;
export type CreateDesignationInput = z.infer<typeof createDesignationSchema>;
export type UpdateDesignationInput = z.infer<typeof updateDesignationSchema>;
export type CreatePositionInput = z.infer<typeof createPositionSchema>;
export type UpdatePositionInput = z.infer<typeof updatePositionSchema>;
export type UpdatePositionPoliciesInput = z.infer<typeof updatePositionPoliciesSchema>;
export type ManagerReassignmentInput = z.infer<typeof managerReassignmentSchema>;
export type ConfirmManagerReassignmentInput = z.infer<
  typeof confirmManagerReassignmentSchema
>;
