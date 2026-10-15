/**
 * Sales v1.1 — realtime emitters for the bid pool and lead detail (PRD §8).
 *
 * The platform already defines per-person rooms (`emitToUser`) and the
 * socket authenticator joins each principal to theirs on connect. The
 * bidding pool uses that primitive directly: an emit to the pool is a
 * fanout to the personal rooms of every eligible agent in the pool,
 * resolved by the caller via the availability facade.
 *
 * Lead-detail subscribers subscribe to a lead-specific room on open and
 * leave on close; the client lifecycle lives in `useLiveLead.ts`.
 */

import { emitToUser } from '../../../platform/realtime/server.js';

// Event names — stable client contract. Changes here are visible to
// every connected sales agent, so bump a client version if payload
// shape evolves.
export const SALES_EVENT = {
  BID_POOL_ADDED: 'sales.bid-pool.added',
  BID_POOL_REMOVED: 'sales.bid-pool.removed',
  BID_POOL_VIEWER_COUNT: 'sales.bid-pool.viewer-count',
  LEAD_CLAIMED: 'sales.lead.claimed',
  LEAD_REASSIGNED: 'sales.lead.reassigned',
} as const;

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
  readonly createdAt: string;              // ISO
  readonly expiresAt: string;              // ISO
}

export interface BidPoolAddedPayload {
  readonly card: MaskedBidCard;
}

export interface BidPoolRemovedPayload {
  readonly leadId: string;
  readonly reason: 'claimed' | 'expired' | 'passed' | 'retracted' | 'reassigned';
}

export interface BidPoolViewerCountPayload {
  readonly leadId: string;
  readonly count: number;
}

export interface LeadClaimedPayload {
  readonly leadId: string;
  readonly claimedByUserId: string;
  readonly claimedAt: string;
}

export interface LeadReassignedPayload {
  readonly leadId: string;
  readonly fromUserId: string | null;
  readonly toUserId: string;
  readonly reason: string;
  readonly reassignedAt: string;
  readonly sourcingCreditTransferred: boolean;
}

/**
 * Emit the card to every eligible agent's personal room. The caller
 * resolved eligibility via the availability facade; this function does
 * not re-evaluate so a near-stale snapshot is accepted — the atomic
 * claim check at `POST /api/bid-pool/:leadId/claim` is the real guard.
 */
export function emitBidPoolAdded(
  organizationId: string,
  eligibleUserIds: readonly string[],
  payload: BidPoolAddedPayload,
): void {
  for (const userId of eligibleUserIds) {
    emitToUser(organizationId, userId, SALES_EVENT.BID_POOL_ADDED, payload as unknown as Record<string, unknown>);
  }
}

/**
 * Emit to every agent in the recipient list. For removals we overshoot
 * rather than track exact viewers: the client ignores an unknown leadId
 * silently. The recipient list is typically the same eligible-agents
 * set used for the add; for claim-driven removals it may be larger (the
 * expanded pool after fallback).
 */
export function emitBidPoolRemoved(
  organizationId: string,
  recipientUserIds: readonly string[],
  payload: BidPoolRemovedPayload,
): void {
  for (const userId of recipientUserIds) {
    emitToUser(organizationId, userId, SALES_EVENT.BID_POOL_REMOVED, payload as unknown as Record<string, unknown>);
  }
}

/**
 * Viewer count is debounced on the server (one emit per 10 seconds per
 * lead) by whichever caller tracks viewers. The function itself just
 * fans out — the debounce is in the service layer.
 */
export function emitBidPoolViewerCount(
  organizationId: string,
  recipientUserIds: readonly string[],
  payload: BidPoolViewerCountPayload,
): void {
  for (const userId of recipientUserIds) {
    emitToUser(organizationId, userId, SALES_EVENT.BID_POOL_VIEWER_COUNT, payload as unknown as Record<string, unknown>);
  }
}

/**
 * Lead-detail events go only to the claimer and anyone currently
 * viewing the detail page (and sales managers in scope). The caller
 * passes the exact recipient set resolved by the detail subscription
 * tracker.
 */
export function emitLeadClaimed(
  organizationId: string,
  recipientUserIds: readonly string[],
  payload: LeadClaimedPayload,
): void {
  for (const userId of recipientUserIds) {
    emitToUser(organizationId, userId, SALES_EVENT.LEAD_CLAIMED, payload as unknown as Record<string, unknown>);
  }
}

export function emitLeadReassigned(
  organizationId: string,
  recipientUserIds: readonly string[],
  payload: LeadReassignedPayload,
): void {
  for (const userId of recipientUserIds) {
    emitToUser(organizationId, userId, SALES_EVENT.LEAD_REASSIGNED, payload as unknown as Record<string, unknown>);
  }
}
