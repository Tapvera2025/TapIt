import { z } from 'zod';

const uuid = z.string().uuid();
const reason = z.string().trim().min(3).max(1000);
const money = z.string().regex(/^\d+(\.\d{1,2})?$/);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const vendorSchema = z.object({
  legalName: z.string().trim().min(2).max(200),
  displayName: z.string().trim().min(2).max(200),
  email: z.string().email().optional(),
  phone: z.string().trim().max(40).optional(),
  gstin: z.string().trim().max(30).optional(),
  pan: z.string().trim().max(20).optional(),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .default('INR'),
  paymentTermsDays: z.number().int().min(0).max(365).default(30),
});
export const bankChangeSchema = z.object({
  bankName: z.string().trim().min(2).max(200),
  accountReference: z.string().trim().min(4).max(200),
  ifsc: z.string().trim().max(20).optional(),
  reason,
});
export const billSchema = z.object({
  vendorId: uuid.optional(),
  invoiceNumber: z.string().trim().min(1).max(100),
  issueDate: date,
  dueDate: date,
  currency: z.string().regex(/^[A-Z]{3}$/),
  subtotal: money,
  taxTotal: money.default('0'),
  total: money,
  gstin: z.string().trim().max(30).optional(),
  tdsSection: z.string().trim().max(30).optional(),
  tdsRate: z.number().min(0).max(100).default(0),
  rcm: z.boolean().default(false),
  extractionStatus: z.enum(['manual', 'needs_review', 'confirmed']).default('manual'),
  reason,
  artifact: z
    .object({
      originalFilename: z.string().trim().min(1).max(255),
      mimeType: z.string().trim().min(1).max(100),
      data: z.string().min(1),
    })
    .optional(),
});
export const billDecisionSchema = z.object({ reason });
export const extractionConfirmationSchema = z.object({ reason });
export const reimbursementSchema = z.object({ claimId: uuid, reason });
export const purchaseRequestDecisionSchema = z.object({ reason });
export const purchaseRequestMatchSchema = z.object({ billId: uuid, reason });
export const billFromPurchaseRequestSchema = z.object({ requestId: uuid, reason });
export const subscriptionSchema = z.object({
  vendorId: uuid,
  name: z.string().trim().min(2).max(200),
  amount: money,
  currency: z.string().regex(/^[A-Z]{3}$/),
  recurrence: z.enum(['monthly', 'quarterly', 'annual']),
  nextDueDate: date,
  ownerId: uuid.optional(),
  reason,
});
export const purchaseRequestSchema = z.object({
  vendorId: uuid.optional(),
  description: z.string().trim().min(3).max(500),
  amount: money,
  currency: z.string().regex(/^[A-Z]{3}$/),
  reason,
});
export const paymentRunSchema = z.object({
  billIds: z.array(uuid).min(1),
  currency: z.string().regex(/^[A-Z]{3}$/),
  reason,
});
export const paymentRunDecisionSchema = z.object({ reason });
export type VendorInput = z.infer<typeof vendorSchema>;
export type BankChangeInput = z.infer<typeof bankChangeSchema>;
export type BillInput = z.infer<typeof billSchema>;
export type BillDecisionInput = z.infer<typeof billDecisionSchema>;
export type ReimbursementInput = z.infer<typeof reimbursementSchema>;
export type PurchaseRequestDecisionInput = z.infer<typeof purchaseRequestDecisionSchema>;
export type PurchaseRequestMatchInput = z.infer<typeof purchaseRequestMatchSchema>;
export type SubscriptionInput = z.infer<typeof subscriptionSchema>;
export type PurchaseRequestInput = z.infer<typeof purchaseRequestSchema>;
export type PaymentRunInput = z.infer<typeof paymentRunSchema>;
export type PaymentRunDecisionInput = z.infer<typeof paymentRunDecisionSchema>;
