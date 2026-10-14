import { identityRequest } from '../../../identity/api/authApi.js';

export type ApprovalState =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'returned'
  | 'escalated'
  | 'cancelled'
  | 'invalidated';

export type ApprovalVerdict = 'approve' | 'reject' | 'return';

export type ApprovalDimension =
  | { readonly kind: 'value'; readonly status: 'ok' }
  | {
      readonly kind: 'value';
      readonly status: 'exceeds';
      readonly totalMinor: string;
      readonly limitMinor: string;
    }
  | { readonly kind: 'discount'; readonly status: 'ok' }
  | {
      readonly kind: 'discount';
      readonly status: 'exceeds';
      readonly discountBps: number;
      readonly limitBps: number;
    }
  | { readonly kind: 'advance'; readonly status: 'ok' }
  | {
      readonly kind: 'advance';
      readonly status: 'below_policy';
      readonly advanceBps: number;
      readonly policyBps: number;
    }
  | { readonly kind: 'custom_terms'; readonly status: 'ok' }
  | {
      readonly kind: 'custom_terms';
      readonly status: 'required';
      readonly reason: string;
    };

export interface ApprovalRequest {
  readonly id: string;
  readonly organizationId: string;
  readonly dealId: string;
  readonly commercialsId: string;
  readonly dimensions: readonly ApprovalDimension[];
  readonly requestedBy: string;
  readonly requestedAt: string;
  readonly currentApproverId: string | null;
  readonly slaDueAt: string;
  readonly escalationCount: number;
  readonly state: ApprovalState;
  readonly blockedReason: string | null;
  readonly decidedAt: string | null;
  readonly decidedBy: string | null;
}

export function listPendingApprovals(): Promise<readonly ApprovalRequest[]> {
  return identityRequest('/api/approvals/queue');
}

export function decideApproval(
  id: string,
  verdict: ApprovalVerdict,
  comment?: string,
): Promise<ApprovalRequest> {
  return identityRequest(`/api/approvals/${encodeURIComponent(id)}/decide`, {
    method: 'POST',
    body: JSON.stringify({ verdict, ...(comment ? { comment } : {}) }),
  });
}

export function requestApprovalForCommercials(commercialsId: string): Promise<ApprovalRequest> {
  return identityRequest(
    `/api/commercials/${encodeURIComponent(commercialsId)}/request-approval`,
    { method: 'POST', body: JSON.stringify({}) },
  );
}
