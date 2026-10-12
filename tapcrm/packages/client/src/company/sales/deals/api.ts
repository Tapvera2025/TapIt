import { identityRequest } from '../../../identity/api/authApi.js';

export type DealStage = 'discovery' | 'proposal' | 'negotiation' | 'closing' | 'closed';
export type DealLifecycleStatus = 'open' | 'won' | 'lost' | 'cancelled';
export type DealApprovalStatus = 'not_required' | 'pending' | 'approved' | 'rejected';
export type DealContractStatus = 'not_required' | 'draft' | 'sent' | 'signed' | 'voided';
export type DealPaymentStatus =
  | 'unpaid'
  | 'partial'
  | 'advance_confirmed'
  | 'paid'
  | 'partially_refunded'
  | 'refunded';

export type DealLossReason =
  | 'not_interested'
  | 'no_budget'
  | 'no_need'
  | 'competitor'
  | 'timing'
  | 'unqualified'
  | 'duplicate'
  | 'other';

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
  readonly expectedCloseAt: string | null;
  readonly probabilityOverride: number | null;
  readonly commercialsId: string | null;
  readonly dealStage: DealStage;
  readonly approvalStatus: DealApprovalStatus;
  readonly contractStatus: DealContractStatus;
  readonly paymentStatus: DealPaymentStatus;
  readonly lifecycleStatus: DealLifecycleStatus;
  readonly lossReason: DealLossReason | null;
  readonly lostAt: string | null;
  readonly wonAt: string | null;
  readonly cancelledAt: string | null;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface DealPage {
  readonly items: readonly Deal[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
  readonly totalPages: number;
}

export interface DealListQuery {
  readonly page?: number;
  readonly pageSize?: number;
  readonly stage?: DealStage;
  readonly lifecycleStatus?: DealLifecycleStatus;
  readonly responsibleCloserId?: string;
  readonly expectedCloseFrom?: string;
  readonly expectedCloseTo?: string;
  readonly search?: string;
}

export interface UnmetCondition {
  readonly condition:
    | 'commercials'
    | 'approval'
    | 'contract'
    | 'payment'
    | 'delivery_brief'
    | 'authority'
    | 'already_closed'
    | 'already_terminal';
  readonly description: string;
  readonly resolver: string;
}

export interface ReadinessReport {
  readonly canClose: boolean;
  readonly unmet: readonly UnmetCondition[];
}

export interface WinsToRecordRow {
  readonly id: string;
  readonly dealNumber: string;
  readonly title: string;
  readonly responsibleCloserId: string;
  readonly originatingAgentId: string;
  readonly approvalStatus: DealApprovalStatus;
  readonly contractStatus: DealContractStatus;
  readonly commercialsId: string | null;
  readonly updatedAt: string;
}

function toQuery(query: DealListQuery): string {
  const params = new URLSearchParams();
  if (query.page !== undefined) params.set('page', String(query.page));
  if (query.pageSize !== undefined) params.set('pageSize', String(query.pageSize));
  if (query.stage) params.set('stage', query.stage);
  if (query.lifecycleStatus) params.set('lifecycleStatus', query.lifecycleStatus);
  if (query.responsibleCloserId) params.set('responsibleCloserId', query.responsibleCloserId);
  if (query.expectedCloseFrom) params.set('expectedCloseFrom', query.expectedCloseFrom);
  if (query.expectedCloseTo) params.set('expectedCloseTo', query.expectedCloseTo);
  if (query.search) params.set('search', query.search);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export function listDeals(query: DealListQuery = {}): Promise<DealPage> {
  return identityRequest(`/api/deals${toQuery(query)}`);
}

export function getDeal(id: string): Promise<Deal> {
  return identityRequest(`/api/deals/${encodeURIComponent(id)}`);
}

export interface CreateDealInput {
  readonly originatingLeadId?: string;
  readonly directEntryReason?: string;
  /** Optional when `originatingLeadId` is set — server resolves from lead lineage. */
  readonly contactId?: string;
  readonly companyId?: string;
  readonly serviceRequested?: string;
  readonly title: string;
  readonly scopeSummary?: string;
  readonly responsibleCloserId?: string;
  readonly currency?: string;
  readonly expectedCloseAt?: string;
}

export function createDeal(input: CreateDealInput): Promise<Deal> {
  return identityRequest('/api/deals', { method: 'POST', body: JSON.stringify(input) });
}

export function updateDealStage(id: string, stage: DealStage): Promise<Deal> {
  return identityRequest(`/api/deals/${encodeURIComponent(id)}/stage`, {
    method: 'POST',
    body: JSON.stringify({ dealStage: stage }),
  });
}

export function overrideProbability(id: string, probability: number, reason: string): Promise<Deal> {
  return identityRequest(`/api/deals/${encodeURIComponent(id)}/probability`, {
    method: 'POST',
    body: JSON.stringify({ probability, reason }),
  });
}

export function markDealLost(id: string, reason: DealLossReason, note?: string): Promise<Deal> {
  return identityRequest(`/api/deals/${encodeURIComponent(id)}/lost`, {
    method: 'POST',
    body: JSON.stringify({ reason, note }),
  });
}

export function cancelDealAfterWin(id: string, reason: string): Promise<Deal> {
  return identityRequest(`/api/deals/${encodeURIComponent(id)}/cancel-after-win`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}

export function getWinReadiness(id: string): Promise<ReadinessReport> {
  return identityRequest(`/api/deals/${encodeURIComponent(id)}/win-readiness`);
}

export function recordDealWin(id: string): Promise<Deal> {
  return identityRequest(`/api/deals/${encodeURIComponent(id)}/record-win`, { method: 'POST' });
}

export function listWinsToRecord(): Promise<readonly WinsToRecordRow[]> {
  return identityRequest('/api/deals/wins-to-record');
}
