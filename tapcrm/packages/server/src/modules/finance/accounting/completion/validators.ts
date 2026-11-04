import { z } from 'zod';

const currency = z.string().regex(/^[A-Z]{3}$/);
const reason = z.string().trim().min(3).max(1000);
const uuid = z.string().uuid();

export const entitySchema = z.object({
  code: z.string().trim().min(1).max(32),
  legalName: z.string().trim().min(2).max(240),
  countryCode: z.string().regex(/^[A-Z]{2}$/).default('IN'),
  baseCurrency: currency,
  timezone: z.string().trim().min(1).max(80).default('Asia/Kolkata'),
  taxRegistration: z.record(z.string(), z.string()).default({}),
  reason,
});

export const scheduleSchema = z.object({
  legalEntityId: uuid.nullable().optional(),
  scheduleType: z.enum(['deferred_revenue', 'accrual', 'prepayment']),
  description: z.string().trim().min(2).max(500),
  sourceType: z.string().trim().min(1).max(100),
  sourceId: uuid.nullable().optional(),
  debitAccountId: uuid,
  creditAccountId: uuid,
  totalAmount: z.string().regex(/^\d+(\.\d{1,2})?$/),
  currency,
  startDate: z.string().date(),
  endDate: z.string().date(),
  nextRecognitionDate: z.string().date(),
  reason,
});

export const recognizeScheduleSchema = z.object({
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/),
  entryDate: z.string().date(),
  reason,
});

export const revaluationSchema = z.object({
  legalEntityId: uuid.nullable().optional(),
  asOfDate: z.string().date(),
  baseCurrency: currency,
  idempotencyKey: z.string().trim().min(8).max(240),
  gainLossAccountId: uuid,
  lines: z.array(z.object({
    accountId: uuid,
    currency,
    foreignAmount: z.string().regex(/^\d+(\.\d{1,2})?$/),
    oldBaseAmount: z.string().regex(/^\d+(\.\d{1,2})?$/),
    newBaseAmount: z.string().regex(/^\d+(\.\d{1,2})?$/),
    rate: z.string().regex(/^\d+(\.\d{1,8})?$/),
  })).min(1).max(200),
  reason,
});

export const syncSchema = z.object({
  provider: z.string().trim().min(2).max(80),
  entityId: uuid.nullable().optional(),
  sourceType: z.string().trim().min(1).max(100),
  sourceId: uuid,
  idempotencyKey: z.string().trim().min(8).max(240),
  payload: z.record(z.string(), z.unknown()),
  reason,
});

export const idSchema = z.object({ id: uuid });
export type EntityInput = z.infer<typeof entitySchema>;
export type ScheduleInput = z.infer<typeof scheduleSchema>;
export type RecognizeInput = z.infer<typeof recognizeScheduleSchema>;
export type RevaluationInput = z.infer<typeof revaluationSchema>;
export type SyncInput = z.infer<typeof syncSchema>;
