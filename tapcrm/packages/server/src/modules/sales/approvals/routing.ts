/**
 * Sales v1.1 R2 — Approval routing (R2 plan step 2.11, R-APP-03).
 *
 * "Lowest eligible independent authority holding every exceeded dimension."
 *
 *   - Walk the reportsTo chain upward from the requester.
 *   - For each candidate, check their authority against every exceeded
 *     dimension. If every exceeded dimension is covered, they are eligible.
 *   - Independence: the candidate must NOT be the requester (self-approval
 *     is refused per A-1 absolute constraint; the walk starts at the
 *     requester's manager).
 *   - If the chain exhausts without a hit, return null; the caller marks
 *     the request `pending` with a `blocked_reason: 'no_eligible_approver'`.
 */

import type { ActorAuthority } from './types.js';

export interface Candidate {
  readonly userId: string;
  readonly reportsTo: string | null;
  readonly authority: ActorAuthority;
}

/** Does `authority` cover every exceeded dimension in `exceeded`? */
export function covers(authority: ActorAuthority, snapshot: {
  totalMinor: bigint;
  discountBps: number;
  advanceBps: number;
  requiresCustomTerms: boolean;
}): boolean {
  if (authority.maxValueMinor !== null && snapshot.totalMinor > authority.maxValueMinor) return false;
  if (authority.maxDiscountBps !== null && snapshot.discountBps > authority.maxDiscountBps) return false;
  if (snapshot.requiresCustomTerms && !authority.allowsCustomTerms) return false;
  return true;
}

export interface AuthoritySnapshot {
  readonly totalMinor: bigint;
  readonly discountBps: number;
  readonly advanceBps: number;
  readonly requiresCustomTerms: boolean;
}

export type AuthorityResolver = (userId: string) => Promise<Candidate | null>;

/**
 * Walk the reportsTo chain from `startFromUserId` upward. The requester
 * themselves is NOT a candidate — segregation of duties A-1 refuses
 * self-approval even if they technically have higher limits.
 */
export async function findLowestEligibleApprover(
  requesterId: string,
  snapshot: AuthoritySnapshot,
  resolve: AuthorityResolver,
  maxDepth = 10,
): Promise<Candidate | null> {
  const requester = await resolve(requesterId);
  if (!requester) return null;
  let currentId: string | null = requester.reportsTo;
  const visited = new Set<string>([requesterId]);
  for (let depth = 0; depth < maxDepth && currentId; depth++) {
    if (visited.has(currentId)) return null;             // cycle guard
    visited.add(currentId);
    const candidate = await resolve(currentId);
    if (!candidate) return null;
    if (covers(candidate.authority, snapshot)) return candidate;
    currentId = candidate.reportsTo;
  }
  return null;
}
