import { z } from 'zod';

const currency = z.string().trim().regex(/^[A-Z]{3}$/, 'Use a 3-letter ISO currency code, such as INR or USD.');

export const updateFinanceFoundationSchema = z.object({
  legalName: z.string().trim().min(1, 'Legal entity name is required.').max(200, 'Legal entity name cannot exceed 200 characters.'),
  countryCode: z.string().trim().regex(/^[A-Z]{2}$/, 'Country code must be a 2-letter ISO code, such as IN or US.'),
  functionalCurrency: currency,
  supportedCurrencies: z.array(currency).min(1, 'Enter at least one supported currency.').max(20, 'You can configure at most 20 supported currencies.').superRefine((values, context) => {
    if (new Set(values).size !== values.length) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Supported currencies must be unique.' });
  }),
  timezone: z.string().trim().min(1, 'Organization timezone is required.').max(80, 'Timezone cannot exceed 80 characters.'),
  fiscalYearStartMonth: z.number().int().min(1).max(12),
  status: z.enum(['draft', 'pending_review', 'active', 'inactive']),
  taxPolicyStatus: z.enum(['pending_review', 'configured']),
  statutorySourceStatus: z.enum(['pending_review', 'configured']),
  revenuePolicyStatus: z.enum(['pending_review', 'configured']),
  paymentProviderStatus: z.enum(['pending_review', 'configured']),
  expectedVersion: z.number().int().positive(),
  reason: z.string().trim().min(3, 'Reason must be at least 3 characters.').max(1000, 'Reason cannot exceed 1000 characters.'),
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
