import type { Resource } from '@tapcrm/authz';

export const DEAL_STAGES = ['discovery', 'proposal', 'negotiation', 'closing', 'closed'] as const;
export type DealStage = (typeof DEAL_STAGES)[number];

export const DEAL_LIFECYCLE_STATUSES = ['open', 'won', 'lost', 'cancelled'] as const;
export type DealLifecycleStatus = (typeof DEAL_LIFECYCLE_STATUSES)[number];

export const DEAL_APPROVAL_STATUSES = ['not_required', 'pending', 'approved', 'rejected'] as const;
export type DealApprovalStatus = (typeof DEAL_APPROVAL_STATUSES)[number];

export const DEAL_CONTRACT_STATUSES = ['not_required', 'draft', 'sent', 'signed', 'voided'] as const;
export type DealContractStatus = (typeof DEAL_CONTRACT_STATUSES)[number];

export const DEAL_PAYMENT_STATUSES = [
  'unpaid',
  'partial',
  'advance_confirmed',
  'paid',
  'partially_refunded',
  'refunded',
] as const;
export type DealPaymentStatus = (typeof DEAL_PAYMENT_STATUSES)[number];

/** Structured loss reasons (R-DEAL-05 — "Lost deals need structured reasons"). */
export const DEAL_LOSS_REASONS = [
  'not_interested',
  'no_budget',
  'no_need',
  'competitor',
  'timing',
  'unqualified',
  'duplicate',
  'other',
] as const;
export type DealLossReason = (typeof DEAL_LOSS_REASONS)[number];

export interface Deal {
  readonly id: string;
  readonly organizationId: string;
  readonly dealNumber: string;
  readonly originatingLeadId: string | null;
  readonly directEntryReason: string | null;
  readonly contactId: string;
  readonly contactName: string | null;
  readonly companyId: string | null;
  readonly companyName: string | null;
  readonly serviceRequested: string | null;
  readonly title: string;
  readonly scopeSummary: string | null;
  readonly originatingAgentId: string;
  readonly originatingAgentName: string | null;
  readonly responsibleCloserId: string;
  readonly responsibleCloserName: string | null;
  readonly closedById: string | null;
  readonly currency: string;
  readonly expectedCloseAt: Date | null;
  readonly probabilityOverride: number | null;
  readonly commercialsId: string | null;
  readonly dealStage: DealStage;
  readonly approvalStatus: DealApprovalStatus;
  readonly contractStatus: DealContractStatus;
  readonly paymentStatus: DealPaymentStatus;
  readonly lifecycleStatus: DealLifecycleStatus;
  readonly lossReason: DealLossReason | null;
  readonly lostAt: Date | null;
  readonly wonAt: Date | null;
  readonly cancelledAt: Date | null;
  readonly createdBy: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export type DealResource = Resource & {
  readonly type: 'deal';
  readonly organizationId: string;
  readonly responsibleCloserId: string;
  readonly originatingAgentId: string;
  readonly lifecycleStatus: DealLifecycleStatus;
};
