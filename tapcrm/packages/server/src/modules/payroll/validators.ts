import { z } from 'zod';

export const createRunSchema = z.object({
  periodStart: z.string().regex(/^\d{4}-\d{2}-01$/),
});

export const acceptConfigSchema = z.object({
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-01$/),
  settings: z.record(z.unknown()),
  schemaVersion: z.string().optional(),
  caHrApproval: z.string().min(1),
  sources: z.array(z.object({
    statutoryChoice: z.string().min(1),
    issuer: z.string().min(1),
    title: z.string().min(1),
    reference: z.string().min(1),
    sourceDate: z.string(),
    effectiveDate: z.string(),
    retainedObjectKey: z.string().optional().nullable(),
    retainedSha256: z.string().optional().nullable(),
  })),
  supersedesConfigId: z.string().uuid().optional().nullable(),
});

export const createStructureSchema = z.object({
  userId: z.string().uuid(),
  currency: z.string().length(3),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  effectiveTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  lines: z.array(z.object({
    code: z.string().min(1),
    label: z.string().min(1),
    kind: z.enum(['earning', 'deduction', 'employer-contribution']),
    amount: z.number().nonnegative(),
    prorated: z.boolean(),
    statutoryTags: z.array(z.string()),
    sortOrder: z.number().int(),
  })),
});

export const createInputSchema = z.object({
  userId: z.string().uuid(),
  periodStart: z.string().regex(/^\d{4}-\d{2}-01$/),
  kind: z.enum(['adjustment', 'advance-recovery', 'arrear', 'bonus', 'tds']),
  amount: z.number().positive(),
  label: z.string().min(1),
  reason: z.string().min(1),
});

export const revokeInputSchema = z.object({
  reason: z.string().min(1),
});

export const reviseSlipSchema = z.object({
  reason: z.string().min(1),
});

export const patchRunSchema = z.object({
  action: z.enum(['start', 'cancel']),
});
