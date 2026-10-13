/**
 * Sales v1.1 R2 — Approval types (R2 plan step 2.11).
 */

import type { Resource } from '@tapcrm/authz';

export const APPROVAL_STATES = [
  'pending',
  'approved',
  'rejected',
  'returned',
  'escalated',
  'cancelled',
  'invalidated',
] as const;
export type ApprovalState = (typeof APPROVAL_STATES)[number];

export const APPROVAL_VERDICTS = ['approve', 'reject', 'return'] as const;
export type ApprovalVerdict = (typeof APPROVAL_VERDICTS)[number];

/**
 * One row per approval dimension (R-APP-01). `status` tells the UI
 * whether the dimension is in-bounds or exceeded; the extra fields
 * contextualise the breach so the issuer can see "₹2L over the ₹5L
 * limit", not just "exceeds".
 */
export type ApprovalDimension =
  | { kind: 'value'; status: 'ok' }
  | { kind: 'value'; status: 'exceeds'; totalMinor: string; limitMinor: string }
  | { kind: 'discount'; status: 'ok' }
  | { kind: 'discount'; status: 'exceeds'; discountBps: number; limitBps: number }
  | { kind: 'advance'; status: 'ok' }
  | { kind: 'advance'; status: 'below_policy'; advanceBps: number; policyBps: number }
  | { kind: 'custom_terms'; status: 'ok' }
  | { kind: 'custom_terms'; status: 'required'; reason: string };

export interface ApprovalDimensionsSnapshot {
  readonly dimensions: readonly ApprovalDimension[];
  readonly requiresApproval: boolean;
  readonly exceeded: readonly ApprovalDimension['kind'][];
}

export interface ActorAuthority {
  readonly maxValueMinor: bigint | null;        // null = unlimited
  readonly maxDiscountBps: number | null;        // null = unlimited (0..10000)
  readonly minAdvanceBps: number | null;         // null = no minimum
  readonly allowsCustomTerms: boolean;
}

export interface ApprovalRequest {
  readonly id: string;
  readonly organizationId: string;
  readonly dealId: string;
  readonly commercialsId: string;
  readonly dimensions: readonly ApprovalDimension[];
  readonly requestedBy: string;
  readonly requestedAt: Date;
  readonly currentApproverId: string | null;
  readonly slaDueAt: Date;
  readonly escalationCount: number;
  readonly state: ApprovalState;
  readonly blockedReason: string | null;
  readonly decidedAt: Date | null;
  readonly decidedBy: string | null;
}

export interface ApprovalDecision {
  readonly id: string;
  readonly requestId: string;
  readonly actorId: string;
  readonly verdict: ApprovalVerdict;
  readonly comment: string | null;
  readonly decidedAt: Date;
}

export type ApprovalResource = Resource & {
  readonly type: 'approvalRequest';
  readonly organizationId: string;
  readonly dealId: string;
  readonly requestedBy: string;
  readonly currentApproverId: string | null;
  readonly state: ApprovalState;
};
