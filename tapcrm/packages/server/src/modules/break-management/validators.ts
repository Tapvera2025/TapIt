import { z } from 'zod';

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD');
const uuid = z.string().uuid();
const positiveInt = z.number().int().positive();

const conditionSchema = z.enum(['over-total', 'over-single', 'under-total', 'count-over']);
const occurrenceWindowSchema = z.enum(['day', 'week', 'month']);
const consequenceSchema = z.enum([
  'warn', 'notify-manager', 'require-explanation',
  'mark-late', 'mark-half-day', 'mark-absent',
  'deduct-minutes', 'deduct-amount',
]);

export const penaltyRuleSchema = z.object({
  ordinal: positiveInt,
  condition: conditionSchema,
  occurrenceWindow: occurrenceWindowSchema,
  occurrenceCount: positiveInt.default(1),
  consequence: consequenceSchema,
  minutes: positiveInt.optional().nullable(),   // required for deduct-minutes
  amount: z.number().positive().optional().nullable(),  // required for deduct-amount
  autoApply: z.boolean().default(false),
}).refine((r) => r.consequence !== 'deduct-minutes' || r.minutes != null, {
  message: 'minutes required for deduct-minutes',
}).refine((r) => r.consequence !== 'deduct-amount' || r.amount != null, {
  message: 'amount required for deduct-amount',
});

export const createPolicySchema = z.object({
  name: z.string().min(1).max(100),
  effectiveFrom: dateOnly,
  upperTotalMinutes: positiveInt.optional().nullable(),
  upperSingleMinutes: positiveInt.optional().nullable(),
  lowerTotalMinutes: positiveInt.optional().nullable(),
  lowerEnforced: z.boolean().default(false),
  graceMinutes: z.number().int().min(0).default(0),
  warningPercent: z.number().int().min(1).max(100).default(80),
  countsTowardWorkHours: z.boolean().default(true),
  rules: z.array(penaltyRuleSchema).min(0),
});
export type CreatePolicyBody = z.infer<typeof createPolicySchema>;

// PATCH creates a new future-dated version
export const revisePolicySchema = z.object({
  effectiveFrom: dateOnly,
  upperTotalMinutes: positiveInt.optional().nullable(),
  upperSingleMinutes: positiveInt.optional().nullable(),
  lowerTotalMinutes: positiveInt.optional().nullable(),
  lowerEnforced: z.boolean().default(false),
  graceMinutes: z.number().int().min(0).default(0),
  warningPercent: z.number().int().min(1).max(100).default(80),
  countsTowardWorkHours: z.boolean().default(true),
  rules: z.array(penaltyRuleSchema).min(1),
  // Attestations for autoApply rules (required for each rule with autoApply=true)
  attestations: z.array(z.object({
    ordinal: positiveInt,
    attestedByUserId: uuid,
    attestedMonth: dateOnly,  // YYYY-MM-01
  })).default([]),
});
export type RevisePolicyBody = z.infer<typeof revisePolicySchema>;

export const assignPolicySchema = z.object({
  effectiveFrom: dateOnly,
  effectiveTo: dateOnly.optional().nullable(),
  priority: z.number().int().default(0),
  // Exactly zero or one scoped target
  departmentId: uuid.optional().nullable(),
  positionId: uuid.optional().nullable(),
  shiftId: uuid.optional().nullable(),
  teamId: uuid.optional().nullable(),
  userId: uuid.optional().nullable(),
}).refine((b) => {
  const targets = [b.departmentId, b.positionId, b.shiftId, b.teamId, b.userId].filter(Boolean);
  return targets.length <= 1;
}, { message: 'At most one target allowed' });
export type AssignPolicyBody = z.infer<typeof assignPolicySchema>;

export const previewPolicySchema = z.object({
  userId: uuid,
  fromDate: dateOnly,
  toDate: dateOnly,
}).refine((b) => {
  const from = new Date(b.fromDate);
  const to = new Date(b.toDate);
  const diff = (to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24);
  return diff >= 0 && diff <= 90;  // max 90-day range
}, { message: 'Date range must be 0–90 days' });
export type PreviewPolicyBody = z.infer<typeof previewPolicySchema>;

export const listPoliciesSchema = z.object({
  after: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListPoliciesQuery = z.infer<typeof listPoliciesSchema>;

export const resolveQuerySchema = z.object({
  date: dateOnly.optional(),  // defaults to today
});
export type ResolveQuery = z.infer<typeof resolveQuerySchema>;
