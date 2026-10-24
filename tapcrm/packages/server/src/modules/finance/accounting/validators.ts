import { z } from 'zod';
import {
  ACCOUNT_NORMAL_BALANCES,
  ACCOUNT_TYPES,
  ACCOUNTING_PERIOD_STATUSES,
} from '@tapcrm/contracts';

export const accountIdSchema = z.object({ id: z.string().uuid() });
export const accountListQuerySchema = z.object({
  status: z.enum(['active', 'inactive', 'all']).default('active'),
});
export const createAccountSchema = z.object({
  code: z.string().trim().min(1).max(32),
  name: z.string().trim().min(1).max(200),
  accountType: z.enum(ACCOUNT_TYPES),
  parentAccountId: z.string().uuid().nullable().optional(),
  normalBalance: z.enum(ACCOUNT_NORMAL_BALANCES),
});
export const updateAccountSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    parentAccountId: z.string().uuid().nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .refine(
    (input) => Object.keys(input).length > 0,
    'At least one account field is required.',
  );
export const periodListQuerySchema = z.object({
  status: z.enum(ACCOUNTING_PERIOD_STATUSES).or(z.literal('all')).default('all'),
});
export const createPeriodSchema = z.object({
  financialYear: z.string().regex(/^\d{4}-\d{4}$/),
  periodStart: z.string().date(),
  periodEnd: z.string().date(),
});
export const closeChecklistSchema = z.object({
  bankReconciled: z.boolean(),
  agingReconciled: z.boolean(),
  payablesReconciled: z.boolean(),
  gstReconciled: z.boolean(),
  trialBalanceReconciled: z.boolean(),
});
export const reopenPeriodSchema = z.object({
  reason: z.string().trim().min(1).max(2000),
});

const decimalSchema = z
  .string()
  .regex(
    /^\d+(\.\d{1,2})?$/,
    'Amounts must be non-negative decimals with at most 2 fractional digits.',
  );

export const journalListQuerySchema = z.object({
  periodId: z.string().uuid().optional(),
  accountId: z.string().uuid().optional(),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
});

export const balanceQuerySchema = z.object({
  periodId: z.string().uuid().optional(),
  accountId: z.string().uuid().optional(),
});

export const reportWindowQuerySchema = z
  .object({
    periodId: z.string().uuid().optional(),
    from: z.string().date().optional(),
    to: z.string().date().optional(),
    comparePeriodId: z.string().uuid().optional(),
    compareFrom: z.string().date().optional(),
    compareTo: z.string().date().optional(),
    accountId: z.string().uuid().optional(),
  })
  .refine(
    (value) => Boolean(value.periodId || (value.from && value.to)),
    'A period or complete date range is required.',
  );

export const statementReportKindSchema = z.enum(['pnl', 'balance-sheet', 'cash-flow']);

export const taxArtifactKindSchema = z.enum(['gstr1', 'gstr3b', 'tds-26q', 'tds-receivable-reconciliation']);
export const gstr2bImportSchema = z.object({
  filename: z.string().trim().min(1).max(255),
  periodStart: z.string().date(),
  periodEnd: z.string().date(),
  contentBase64: z.string().min(1).max(15_000_000),
});

export const createJournalSchema = z.object({
  entryDate: z.string().date(),
  description: z.string().trim().min(1).max(2000),
  sourceType: z.string().trim().min(1).max(100),
  sourceId: z.string().uuid().nullable().optional(),
  reason: z.string().trim().min(1).max(2000).nullable().optional(),
  lines: z
    .array(
      z.object({
        accountId: z.string().uuid(),
        debit: decimalSchema,
        credit: decimalSchema,
        description: z.string().trim().min(1).max(1000).nullable().optional(),
      }),
    )
    .min(2)
    .max(500),
});

export const reverseJournalSchema = z.object({
  entryDate: z.string().date(),
  reason: z.string().trim().min(1).max(2000),
});
