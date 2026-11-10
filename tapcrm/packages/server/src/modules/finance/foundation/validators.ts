import { z } from 'zod';

const currency = z.string().trim().regex(/^[A-Z]{3}$/);

export const updateFinanceFoundationSchema = z.object({
  legalName: z.string().trim().min(1).max(200),
  countryCode: z.string().trim().regex(/^[A-Z]{2}$/),
  functionalCurrency: currency,
  supportedCurrencies: z.array(currency).min(1).max(20),
  timezone: z.string().trim().min(1).max(80),
  fiscalYearStartMonth: z.number().int().min(1).max(12),
  status: z.enum(['draft', 'pending_review', 'active', 'inactive']),
  taxPolicyStatus: z.enum(['pending_review', 'configured']),
  statutorySourceStatus: z.enum(['pending_review', 'configured']),
  revenuePolicyStatus: z.enum(['pending_review', 'configured']),
  paymentProviderStatus: z.enum(['pending_review', 'configured']),
  expectedVersion: z.number().int().positive(),
  reason: z.string().trim().min(3).max(1000),
});

export type UpdateFinanceFoundationInput = z.infer<typeof updateFinanceFoundationSchema>;

export const updateReconciliationSettingsSchema = z.object({
  bankMode: z.enum(['manual_csv', 'api']),
  bankProvider: z.string().trim().max(100).nullable(),
  bankAccountName: z.string().trim().max(160).nullable(),
  bankCurrency: currency,
  bankLedgerAccountId: z.string().uuid().nullable(),
  csvDateColumn: z.string().trim().min(1).max(80),
  csvReferenceColumn: z.string().trim().min(1).max(80),
  csvDescriptionColumn: z.string().trim().min(1).max(80),
  csvDebitColumn: z.string().trim().min(1).max(80),
  csvCreditColumn: z.string().trim().min(1).max(80),
  reason: z.string().trim().min(3).max(1000),
}).superRefine((value, context) => {
  const columns = [value.csvDateColumn, value.csvReferenceColumn, value.csvDescriptionColumn, value.csvDebitColumn, value.csvCreditColumn];
  if (new Set(columns.map((column) => column.toLowerCase())).size !== columns.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['csvDateColumn'], message: 'CSV mapping columns must be unique.' });
  }
});
