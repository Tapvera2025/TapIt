import { z } from 'zod';

const firstOfMonth = z.string().regex(/^\d{4}-\d{2}-01$/, 'must be the first day of a month (YYYY-MM-01)');

/** One billion rupees, in paise: far above any salary line or payroll entry. */
const MAX_PAISE = 100_000_000_000n;

/**
 * Rupees as a decimal string ("45000.50"), because money never travels as a
 * JavaScript number (PG-5). A plain JSON number from an older caller is still
 * accepted when it has at most two decimals. The result is the canonical
 * string ("45000.50"), ready for `decimal()`.
 */
function rupees(options: { readonly allowZero: boolean }) {
  return z.union([z.string().trim(), z.number()]).transform((value, ctx) => {
    const text = typeof value === 'number' ? (Number.isFinite(value) ? String(value) : '') : value;
    const match = /^(\d{1,12})(?:\.(\d{1,2}))?$/.exec(text);
    if (!match) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'enter an amount in rupees, with at most two decimals' });
      return z.NEVER;
    }
    const fraction = (match[2] ?? '').padEnd(2, '0');
    const paise = BigInt(match[1]!) * 100n + BigInt(fraction);
    if (paise === 0n && !options.allowZero) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'the amount must be more than zero' });
      return z.NEVER;
    }
    if (paise > MAX_PAISE) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'the amount is too large' });
      return z.NEVER;
    }
    return `${BigInt(match[1]!).toString()}.${fraction}`;
  });
}
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a date (YYYY-MM-DD)');

export const createRunSchema = z.object({
  periodStart: firstOfMonth,
});

export const acceptConfigSchema = z.object({
  effectiveFrom: firstOfMonth,
  settings: z.record(z.unknown()),
  schemaVersion: z.string().optional(),
  caHrApproval: z.string().trim().min(1, 'say who approved these settings').max(500),
  sources: z.array(z.object({
    statutoryChoice: z.string().min(1),
    issuer: z.string().min(1),
    title: z.string().min(1),
    reference: z.string().min(1),
    sourceDate: isoDate,
    effectiveDate: isoDate,
    retainedObjectKey: z.string().optional().nullable(),
    retainedSha256: z.string().optional().nullable(),
  })).default([]),
  supersedesConfigId: z.string().uuid().optional().nullable(),
});

export const createStructureSchema = z.object({
  /** Optional: the path names the employee; a body that names another one is refused. */
  userId: z.string().uuid().optional(),
  currency: z.string().length(3).default('INR'),
  effectiveFrom: isoDate,
  effectiveTo: isoDate.optional().nullable(),
  lines: z.array(z.object({
    code: z.string().trim().min(1).max(40).regex(/^[A-Za-z0-9_-]+$/, 'use letters, digits, - or _'),
    label: z.string().trim().min(1).max(120),
    kind: z.enum(['earning', 'deduction', 'employer-contribution']),
    amount: rupees({ allowZero: true }),
    prorated: z.boolean().default(true),
    statutoryTags: z.array(z.string()).default([]),
    sortOrder: z.number().int().optional(),
  })).min(1, 'add at least one salary line').max(50),
  replacesStructureId: z.string().uuid().optional().nullable(),
  reason: z.string().trim().max(500).optional().nullable(),
});

export const createInputSchema = z.object({
  userId: z.string().uuid(),
  periodStart: firstOfMonth,
  kind: z.enum(['adjustment', 'advance-recovery', 'arrear', 'bonus', 'tds']),
  amount: rupees({ allowZero: false }),
  label: z.string().trim().min(1).max(120),
  reason: z.string().trim().min(1).max(500),
});

export const listInputsQuerySchema = z.object({
  periodStart: firstOfMonth,
  userId: z.string().uuid().optional(),
});

export const revokeInputSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});

export const reviseSlipSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});

export const patchRunSchema = z.object({
  action: z.enum(['start', 'cancel', 'recalculate']),
});

export const structuresQuerySchema = z.object({
  userId: z.string().uuid().optional(),
  onDate: isoDate.optional(),
});
