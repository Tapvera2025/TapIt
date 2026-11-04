import { z } from 'zod';

export const providerConfigSchema = z.object({
  provider: z.string().regex(/^[a-z0-9_-]{2,64}$/),
  environment: z.enum(['production', 'sandbox']).default('production'),
  publicKey: z.string().trim().min(1),
  secretKey: z.string().min(1),
  supportedCurrencies: z
    .array(z.string().regex(/^[A-Z]{3}$/))
    .min(1)
    .default(['INR']),
  legalEntityId: z.string().uuid().optional(),
  reason: z.string().trim().min(3),
});
export const createLinkSchema = z.object({
  amountMinor: z.coerce.bigint().positive(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  referenceId: z.string().uuid(),
  referenceType: z.enum(['deal', 'invoice', 'manual']).default('deal'),
  returnUrl: z.string().url(),
  provider: z
    .string()
    .regex(/^[a-z0-9_-]{2,64}$/)
    .optional(),
  idempotencyKey: z.string().trim().min(8).max(240).optional(),
});
export type ProviderConfigInput = z.infer<typeof providerConfigSchema>;
export type CreateLinkInput = z.infer<typeof createLinkSchema>;
export const recordReceiptSchema = z.object({
  provider: z.string().regex(/^[a-z0-9_-]{2,64}$/),
  providerEventId: z.string().trim().max(240).optional(),
  providerPaymentId: z.string().trim().max(240).optional(),
  bankReference: z.string().trim().max(240).optional(),
  payerLabel: z.string().trim().max(240).optional(),
  amountMinor: z.coerce.bigint().positive(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  receivedAt: z.string().datetime().optional(),
  feeMinor: z.coerce.bigint().nonnegative().default(0n),
  exchangeRateBps: z.number().int().positive().optional(),
  cashClassification: z
    .enum(['receivable', 'unapplied', 'advance'])
    .default('receivable'),
  referenceType: z.enum(['invoice', 'deal', 'manual']).default('manual'),
  referenceId: z.string().uuid().optional(),
  idempotencyKey: z.string().trim().min(8).max(240),
  note: z.string().trim().max(1000).optional(),
  reason: z.string().trim().min(3).max(1000),
});
export const allocatePaymentSchema = z
  .object({
    invoiceId: z.string().uuid().optional(),
    dealId: z.string().uuid().optional(),
    amountMinor: z.coerce.bigint().positive(),
    reason: z.string().trim().min(3).max(1000),
  })
  .refine((value) => Boolean(value.invoiceId) || Boolean(value.dealId), {
    message: 'An invoice or deal target is required.',
  });
export const verifyReceiptSchema = z.object({
  reason: z.string().trim().min(3).max(1000),
});
export const bankImportSchema = z.object({
  originalFilename: z.string().trim().min(1).max(255),
  data: z.string().min(1),
  format: z.enum(['generic_csv', 'bank_specific_pending']).default('generic_csv'),
});
export const bankMatchSchema = z
  .object({
    receiptId: z.string().uuid().optional(),
    createReceipt: z.boolean().default(false),
    reason: z.string().trim().min(3).max(1000),
  })
  .refine((value) => Boolean(value.receiptId) || value.createReceipt, {
    message: 'Select a receipt or request receipt creation.',
  });
export const settlementSchema = z
  .object({
    provider: z.string().trim().min(2).max(64),
    settlementReference: z.string().trim().min(1).max(240),
    settlementDate: z.string().date(),
    currency: z.string().regex(/^[A-Z]{3}$/),
    grossMinor: z.coerce.bigint().nonnegative(),
    feeMinor: z.coerce.bigint().nonnegative(),
    netMinor: z.coerce.bigint().nonnegative(),
    exchangeRateBps: z.number().int().positive().optional(),
    receiptIds: z.array(z.string().uuid()).max(500).default([]),
    reason: z.string().trim().min(3).max(1000),
  })
  .refine((value) => value.netMinor === value.grossMinor - value.feeMinor, {
    message: 'Settlement net must equal gross less fees.',
  });
export const fxRateSchema = z.object({
  baseCurrency: z.string().regex(/^[A-Z]{3}$/),
  quoteCurrency: z.string().regex(/^[A-Z]{3}$/),
  rateBps: z.number().int().positive(),
  effectiveAt: z.string().datetime(),
  source: z.enum(['manual', 'provider', 'rbi']).default('manual'),
  reason: z.string().trim().min(3).max(1000),
});
export const exceptionResolutionSchema = z.object({
  status: z.enum(['in_review', 'resolved', 'ignored']),
  resolution: z.string().trim().min(3).max(1000),
});
export const settlementImportSchema = z.object({
  originalFilename: z.string().trim().min(1).max(255),
  data: z.string().min(1),
  provider: z.string().regex(/^[a-z0-9_-]{2,64}$/),
  format: z.enum(['generic_csv']).default('generic_csv'),
  reason: z.string().trim().min(3).max(1000),
});
export const fxRevaluationSchema = z.object({
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .refine((value) => value !== 'INR', 'INR does not require FX revaluation.'),
  asOfDate: z.string().date(),
  rateBps: z.number().int().positive(),
  reason: z.string().trim().min(3).max(1000),
});
export type RecordReceiptInput = z.infer<typeof recordReceiptSchema>;
export type AllocatePaymentInput = z.infer<typeof allocatePaymentSchema>;
export type VerifyReceiptInput = z.infer<typeof verifyReceiptSchema>;
export type BankImportInput = z.infer<typeof bankImportSchema>;
export type BankMatchInput = z.infer<typeof bankMatchSchema>;
export type SettlementInput = z.infer<typeof settlementSchema>;
export type FxRateInput = z.infer<typeof fxRateSchema>;
export type ExceptionResolutionInput = z.infer<typeof exceptionResolutionSchema>;
export type SettlementImportInput = z.infer<typeof settlementImportSchema>;
export type FxRevaluationInput = z.infer<typeof fxRevaluationSchema>;
