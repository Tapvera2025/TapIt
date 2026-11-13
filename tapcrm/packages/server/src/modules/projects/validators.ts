import { z } from 'zod';
import { PROJECT_AMOUNT_PATTERN, projectAmountProblem } from './amounts.js';
import { PROJECT_SERVICES } from './types.js';

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
/** An amount in the project's currency, as a decimal string (never a float, TECH.md PG-5). */
const amount = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim())
  .refine((v) => PROJECT_AMOUNT_PATTERN.test(v), 'Enter an amount like 50000 or 50000.50, with no commas');

/** Upfront paid needs a project value and cannot exceed it (when both are in the request). */
function checkAmounts(
  value: { projectValue?: string | null | undefined; upfrontAmount?: string | null | undefined },
  ctx: z.RefinementCtx,
): void {
  if (value.upfrontAmount === undefined || value.projectValue === undefined) return;
  const problem = projectAmountProblem(value.projectValue, value.upfrontAmount);
  if (problem) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['upfrontAmount'], message: problem });
}

const serviceInputSchema = z
  .object({
    service: z.enum(PROJECT_SERVICES),
    otherLabel: z.string().trim().max(100).optional().nullable(),
  })
  .superRefine((value, ctx) => {
    if (value.service === 'other' && !value.otherLabel?.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['otherLabel'], message: 'Name the "Other" service' });
    }
  });

export const createProjectSchema = z
  .object({
    clientId: z.string().uuid(),
    name: z.string().trim().min(1, 'Project name is required').max(200),
    services: z.array(serviceInputSchema).min(1, 'Select at least one service'),
    assigneeIds: z.array(z.string().uuid()).default([]),
    startDate: dateOnly,
    expectedEndDate: dateOnly.optional().nullable(),
    priority: z.enum(['low', 'medium', 'high']),
    workStatus: z.enum(['new', 'ongoing', 'ended', 'expired']).optional(),
    projectValue: amount.optional().nullable(),
    upfrontAmount: amount.optional().nullable(),
    description: z.string().trim().max(10000).optional().nullable(),
    remarks: z.string().trim().max(10000).optional().nullable(),
  })
  .superRefine((value, ctx) => {
    if (value.expectedEndDate && value.expectedEndDate < value.startDate) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['expectedEndDate'], message: 'Expected end date must be on or after the start date' });
    }
    checkAmounts({ projectValue: value.projectValue ?? null, upfrontAmount: value.upfrontAmount ?? null }, ctx);
  });

export const updateProjectSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    services: z.array(serviceInputSchema).min(1).optional(),
    startDate: dateOnly.optional(),
    expectedEndDate: dateOnly.optional().nullable(),
    priority: z.enum(['low', 'medium', 'high']).optional(),
    workStatus: z.enum(['new', 'ongoing', 'ended', 'expired']).optional(),
    projectValue: amount.optional().nullable(),
    upfrontAmount: amount.optional().nullable(),
    description: z.string().trim().max(10000).optional().nullable(),
    remarks: z.string().trim().max(10000).optional().nullable(),
  })
  .superRefine((value, ctx) => {
    if (value.expectedEndDate && value.startDate && value.expectedEndDate < value.startDate) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['expectedEndDate'], message: 'Expected end date must be on or after the start date' });
    }
    // Only one of the two may be in a partial update; the service checks the result against what is stored.
    checkAmounts(value, ctx);
  });

export const projectTeamSchema = z.object({
  assigneeIds: z.array(z.string().uuid()).default([]),
});

export const bulkProjectAssignmentSchema = z.object({
  employeeIds: z.array(z.string().uuid()).min(1).max(200),
  projectIds: z.array(z.string().uuid()).min(1).max(200),
}).superRefine((value, ctx) => {
  if (new Set(value.employeeIds).size !== value.employeeIds.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['employeeIds'], message: 'Duplicate employee IDs are not allowed' });
  }
  if (new Set(value.projectIds).size !== value.projectIds.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['projectIds'], message: 'Duplicate project IDs are not allowed' });
  }
});

export const projectListQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  clientId: z.string().uuid().optional(),
  priority: z.enum(['low', 'medium', 'high', 'all']).default('all'),
  workStatus: z.enum(['new', 'ongoing', 'ended', 'expired', 'all']).default('all'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

/** The wizard's second step: a suggested name and the preselected members, both editable before the group is created. */
export const createDiscussionGroupSchema = z.object({
  name: z.string().trim().min(1, 'Group name is required').max(200),
  memberIds: z.array(z.string().uuid()).min(1, 'A group needs at least one member'),
});

export const updateDiscussionGroupSchema = z.object({
  name: z.string().trim().min(1, 'Group name is required').max(200),
  description: z.string().trim().max(2000).optional().nullable(),
});

export const discussionGroupMembersSchema = z.object({
  memberIds: z.array(z.string().uuid()).min(1, 'Select at least one member').max(500),
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
export type ProjectTeamInput = z.infer<typeof projectTeamSchema>;
export type BulkProjectAssignmentInput = z.infer<typeof bulkProjectAssignmentSchema>;
export type ProjectListQueryInput = z.infer<typeof projectListQuerySchema>;
export type CreateDiscussionGroupInput = z.infer<typeof createDiscussionGroupSchema>;
export type UpdateDiscussionGroupInput = z.infer<typeof updateDiscussionGroupSchema>;
export type DiscussionGroupMembersInput = z.infer<typeof discussionGroupMembersSchema>;
