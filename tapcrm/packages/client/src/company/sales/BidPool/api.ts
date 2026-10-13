import { identityRequest } from '../../../identity/api/authApi.js';

export interface MaskedBidCard {
  readonly leadId: string;
  readonly source: string;
  readonly campaign: string | null;
  readonly service: string | null;
  readonly location: string | null;
  readonly budgetBracket: string | null;
  readonly timeline: string | null;
  readonly messagePreview: string;
  readonly maskedName: string;
  readonly maskedPhone: string;
  readonly maskedEmail: string | null;
  readonly createdAt: string;
  readonly expiresAt: string;
}

export interface ClaimResult {
  readonly leadId: string;
  readonly claimedByUserId: string;
  readonly claimedAt: string;
  readonly slaFirstContactDueAt: string;
}

export function listBidPool(): Promise<{ items: MaskedBidCard[] }> {
  return identityRequest('/api/bid-pool');
}

export function claimBidPoolLead(leadId: string): Promise<ClaimResult> {
  return identityRequest(`/api/bid-pool/${encodeURIComponent(leadId)}/claim`, { method: 'POST' });
}

export function passBidPoolLead(leadId: string, reason: 'wrong_location' | 'out_of_expertise' | 'at_capacity' | 'other'): Promise<{ ok: true }> {
  return identityRequest(`/api/bid-pool/${encodeURIComponent(leadId)}/pass`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}
