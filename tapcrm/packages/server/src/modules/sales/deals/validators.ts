import { z } from 'zod';
import { DEAL_LOSS_REASONS, DEAL_STAGES } from './types.js';

export const createDealSchema = z.object({
  originatingLeadId: z.string().uuid().optional(),
  directEntryReason: z.string().trim().min(5).max(500).optional(),
  /**
   * Optional when `originatingLeadId` is set — the service pulls the
   * contact from the lead's lineage. Direct-entry deals must supply it.
   */
  contactId: z.string().uuid().optional(),
  companyId: z.string().uuid().optional(),
  serviceRequested: z.string().trim().max(200).optional(),
  title: z.string().trim().min(1).max(200),
  scopeSummary: z.string().trim().max(2000).optional(),
  responsibleCloserId: z.string().uuid().optional(),
  currency: z.string().trim().length(3).default('INR'),
  expectedCloseAt: z.coerce.date().optional(),
}).refine(
  (value) => Boolean(value.originatingLeadId) || Boolean(value.directEntryReason),
  { message: 'Either originatingLeadId or directEntryReason is required', path: ['originatingLeadId'] },
).refine(
  (value) => Boolean(value.originatingLeadId) || Boolean(value.contactId),
  { message: 'contactId is required unless originatingLeadId is set', path: ['contactId'] },
);
export type CreateDealInput = z.infer<typeof createDealSchema>;

export const updateDealStageSchema = z.object({
  dealStage: z.enum(DEAL_STAGES),
});
export type UpdateDealStageInput = z.infer<typeof updateDealStageSchema>;

export const overrideProbabilitySchema = z.object({
  probability: z.number().int().min(0).max(100),
  reason: z.string().trim().min(5).max(500),
});
export type OverrideProbabilityInput = z.infer<typeof overrideProbabilitySchema>;

export const markLostSchema = z.object({
  reason: z.enum(DEAL_LOSS_REASONS),
  note: z.string().trim().max(500).optional(),
});
export type MarkLostInput = z.infer<typeof markLostSchema>;

export const cancelAfterWinSchema = z.object({
  reason: z.string().trim().min(5).max(500),
});
export type CancelAfterWinInput = z.infer<typeof cancelAfterWinSchema>;

/**
 * Manual advance-confirmation input. Finance (or Sales HOD acting as
 * Finance for pilot tenants) types in the amount they received, where it
 * came from, and an optional note. Money arrives as a digit-string so
 * the body round-trips through JSON without number precision loss.
 *
 * When `revert` is true the request reverses an earlier confirmation —
 * it requires a reason and ignores amount/reference. The server rejects
 * revert on a won/lost/cancelled deal — once the deal is closed the
 * confirmation is load-bearing for readiness audit, so operations needs
 * to go through a cancellation path instead.
 */
export const confirmPaymentSchema = z
  .object({
    revert: z.boolean().optional(),
    amountMinor: z
      .string()
      .trim()
      .regex(/^\d+$/, 'amountMinor must be a non-negative integer in minor units')
      .optional(),
    reference: z.string().trim().min(1).max(200).optional(),
    note: z.string().trim().max(500).optional(),
    reason: z.string().trim().min(5).max(500).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.revert === true) {
      if (!value.reason) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['reason'], message: 'reason is required when revert is true' });
      }
      return;
    }
    if (!value.amountMinor) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['amountMinor'], message: 'amountMinor is required' });
      return;
    }
    if (BigInt(value.amountMinor) <= 0n) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['amountMinor'], message: 'amountMinor must be positive' });
    }
    if (!value.reference) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['reference'], message: 'reference is required' });
    }
  });
export type ConfirmPaymentInput = z.infer<typeof confirmPaymentSchema>;

export const dealListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(25),
  stage: z.enum(DEAL_STAGES).optional(),
  lifecycleStatus: z.enum(['open', 'won', 'lost', 'cancelled']).optional(),
  responsibleCloserId: z.string().uuid().optional(),
  expectedCloseFrom: z.coerce.date().optional(),
  expectedCloseTo: z.coerce.date().optional(),
  search: z.string().trim().max(100).optional(),
});
export type DealListQuery = z.infer<typeof dealListQuerySchema>;
