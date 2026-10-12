/**
 * Sales v1.1 R2 — Approvals service (R2 plan step 2.11).
 */

import { effectivePolicy, visibilityFilter } from '@tapcrm/authz';
import { globalAccess } from '@tapcrm/contracts';
import { ApplicationError } from '../../../errors.js';
import type { RequestContext } from '../../../platform/dal/context.js';
import { db } from '../../../platform/dal/db.js';
import { PlatformForbiddenError } from '../../../platform/errors.js';
import { sql } from '../../../platform/dal/sql.js';
import { findCommercials } from '../proposals/repository.js';
import { advanceBpsOf, discountBpsOf, evaluateDimensionsForRow, grossSubtotalMinor } from './dimensions.js';
import {
  findPendingForDeal,
  findRequest,
  insertApprovalAudit,
  insertDecision,
  insertRequest,
  invalidateAllPendingForDeal,
  listPendingForApprover,
  listPendingWithScope,
  loadApprovalResource,
  loadUserAuthority,
  lockRequest,
  toActorAuthority,
  updateDealApprovalStatus,
  updateRequestState,
  type UserAuthorityRow,
} from './repository.js';
import { findLowestEligibleApprover, type AuthoritySnapshot, type Candidate } from './routing.js';
import { computeSlaDueAt, isBreached } from './sla.js';
import type { ApprovalRequest, ApprovalVerdict } from './types.js';

export class ApprovalNotFoundError extends ApplicationError {
  constructor() {
    super('Approval request not found', 404, 'APPROVAL_NOT_FOUND');
    this.name = 'ApprovalNotFoundError';
  }
}

export class ApprovalNotRequiredError extends ApplicationError {
  constructor() {
    super('Commercials dimensions do not require approval.', 422, 'APPROVAL_NOT_REQUIRED');
    this.name = 'ApprovalNotRequiredError';
  }
}

export class ApprovalAlreadyOpenError extends ApplicationError {
  constructor(dealId: string) {
    super('Deal already has an open approval request.', 409, 'APPROVAL_ALREADY_OPEN', { dealId });
    this.name = 'ApprovalAlreadyOpenError';
  }
}

export class ApprovalWrongStateError extends ApplicationError {
  constructor(state: string) {
    super(`Approval request is ${state}; cannot be decided.`, 409, 'APPROVAL_WRONG_STATE', { state });
    this.name = 'ApprovalWrongStateError';
  }
}

export class ApprovalSelfApprovalError extends ApplicationError {
  constructor() {
    super('A requester may not approve their own request (A-1).', 403, 'APPROVAL_SELF');
    this.name = 'ApprovalSelfApprovalError';
  }
}

export class ApprovalNotYoursError extends ApplicationError {
  constructor() {
    super('Approval request is not routed to you.', 403, 'APPROVAL_NOT_YOURS');
    this.name = 'ApprovalNotYoursError';
  }
}

export async function listPending(ctx: RequestContext): Promise<readonly ApprovalRequest[]> {
  if (globalAccess(ctx.principal)) {
    const scope = sql`TRUE`;
    return listPendingWithScope(ctx, scope);
  }
  const policy = await effectivePolicy(ctx, 'approvals:decide');
  if (!policy?.allowed) throw new PlatformForbiddenError('approvals:decide not held');
  return listPendingForApprover(ctx, ctx.principal.id);
}

async function resolveCandidate(ctx: RequestContext, userId: string): Promise<Candidate | null> {
  const row = await loadUserAuthority(ctx, userId);
  if (!row) return null;
  return { userId: row.userId, reportsTo: row.reportsTo, authority: toActorAuthority(row) };
}

export async function requestApproval(ctx: RequestContext, commercialsId: string): Promise<ApprovalRequest> {
  const commercials = await findCommercials(ctx, commercialsId);
  if (!commercials) {
    throw new ApplicationError('Commercials not found', 404, 'COMMERCIALS_NOT_FOUND');
  }

  const requester = await loadUserAuthority(ctx, ctx.principal.id);
  if (!requester) {
    throw new ApplicationError('Requester user record missing authority context.', 422, 'APPROVAL_NO_AUTHORITY');
  }
  const snapshot = evaluateDimensionsForRow(commercials, toActorAuthority(requester));
  if (!snapshot.requiresApproval) {
    throw new ApprovalNotRequiredError();
  }

  const authoritySnapshot: AuthoritySnapshot = {
    totalMinor: commercials.totalMinor,
    discountBps: discountBpsOf({
      ...commercials,
      grossSubtotalMinor: grossSubtotalMinor(commercials.items),
    }),
    advanceBps: advanceBpsOf(commercials),
    requiresCustomTerms: snapshot.exceeded.includes('custom_terms'),
  };

  const approver = await findLowestEligibleApprover(
    ctx.principal.id,
    authoritySnapshot,
    (userId) => resolveCandidate(ctx, userId),
  );

  const now = new Date();
  const slaDueAt = computeSlaDueAt(now);

  const requestId = await db.transaction(ctx, async (tx) => {
    const existing = await tx.maybeOne<{ id: string; state: string }>(sql`
      SELECT id, state FROM approval_request
       WHERE organization_id = ${ctx.organizationId}
         AND deal_id         = ${commercials.dealId}
         AND state IN ('pending','escalated','returned')
       FOR UPDATE
    `);
    if (existing) throw new ApprovalAlreadyOpenError(commercials.dealId);

    const id = await insertRequest(tx, ctx.organizationId, {
      dealId: commercials.dealId,
      commercialsId,
      dimensions: snapshot.dimensions,
      requestedBy: ctx.principal.id,
      currentApproverId: approver?.userId ?? null,
      slaDueAt,
      blockedReason: approver ? null : 'no_eligible_approver',
    });

    await updateDealApprovalStatus(tx, ctx.organizationId, commercials.dealId, 'pending');

    await insertApprovalAudit(tx, ctx, 'approval.requested', id, null, {
      dealId: commercials.dealId,
      commercialsId,
      exceeded: snapshot.exceeded,
      approverId: approver?.userId ?? null,
      blockedReason: approver ? null : 'no_eligible_approver',
    });
    return id;
  });

  const created = await findRequest(ctx, requestId);
  if (!created) throw new ApprovalNotFoundError();
  return created;
}

export interface DecideInput {
  readonly verdict: ApprovalVerdict;
  readonly comment?: string | undefined;
}

export async function decide(ctx: RequestContext, requestId: string, input: DecideInput): Promise<ApprovalRequest> {
  const now = new Date();

  await db.transaction(ctx, async (tx) => {
    const locked = await lockRequest(tx, ctx.organizationId, requestId);
    if (!locked) throw new ApprovalNotFoundError();
    if (!['pending', 'escalated', 'returned'].includes(locked.state)) {
      throw new ApprovalWrongStateError(locked.state);
    }
    if (locked.requestedBy === ctx.principal.id && !globalAccess(ctx.principal)) {
      // A-1 segregation: requester cannot approve their own, even if a
      // mis-routed assignment put them in current_approver_id.
      throw new ApprovalSelfApprovalError();
    }
    if (
      !globalAccess(ctx.principal)
      && locked.currentApproverId !== ctx.principal.id
    ) {
      throw new ApprovalNotYoursError();
    }

    await insertDecision(tx, ctx.organizationId, requestId, ctx.principal.id, input.verdict, input.comment ?? null, now);

    const nextState =
      input.verdict === 'approve' ? 'approved'
      : input.verdict === 'reject' ? 'rejected'
      : 'returned';

    await updateRequestState(tx, ctx.organizationId, requestId, {
      state: nextState,
      decidedAt: now,
      decidedBy: ctx.principal.id,
      blockedReason: null,
    });

    if (input.verdict === 'approve') {
      await updateDealApprovalStatus(tx, ctx.organizationId, locked.dealId, 'approved');
    } else if (input.verdict === 'reject') {
      await updateDealApprovalStatus(tx, ctx.organizationId, locked.dealId, 'rejected');
    }
    // 'return' keeps the deal in 'pending' so the salesperson can revise.

    await insertApprovalAudit(tx, ctx, 'approval.decided', requestId,
      { state: locked.state },
      { state: nextState, verdict: input.verdict, decidedBy: ctx.principal.id, at: now.toISOString() },
    );
  });

  const updated = await findRequest(ctx, requestId);
  if (!updated) throw new ApprovalNotFoundError();
  return updated;
}

/**
 * Called by `proposals/service.ts` when a draft is updated. Flips any
 * pending request for the deal to `invalidated` so the salesperson has
 * to re-request after the material change.
 */
export async function invalidateForDeal(ctx: RequestContext, dealId: string): Promise<readonly string[]> {
  const now = new Date();
  const invalidated: readonly string[] = await db.transaction(ctx, async (tx) => {
    const ids = await invalidateAllPendingForDeal(tx, ctx.organizationId, dealId, now);
    if (ids.length === 0) return ids;
    await updateDealApprovalStatus(tx, ctx.organizationId, dealId, 'not_required');
    for (const id of ids) {
      await insertApprovalAudit(tx, ctx, 'approval.invalidated', id,
        { state: 'pending' },
        { state: 'invalidated', reason: 'commercials_changed', at: now.toISOString() },
      );
    }
    return ids;
  });
  return invalidated;
}

/**
 * SLA breach escalator — called by a background worker. For step 2.11 we
 * implement a single escalation per request (R-APP-05 "a second breach
 * does not escalate again"). The escalator walks one step further up the
 * reports chain of the current approver.
 */
export async function escalateIfBreached(ctx: RequestContext, requestId: string, now: Date = new Date()): Promise<ApprovalRequest> {
  await db.transaction(ctx, async (tx) => {
    const locked = await lockRequest(tx, ctx.organizationId, requestId);
    if (!locked) throw new ApprovalNotFoundError();
    if (locked.state !== 'pending' && locked.state !== 'returned') return;
    if (!isBreached(now, locked.slaDueAt)) return;
    if (locked.escalationCount >= 1) return;             // one hop only
    if (!locked.currentApproverId) return;               // nothing to escalate from

    const current: UserAuthorityRow | null = await loadUserAuthority(ctx, locked.currentApproverId);
    if (!current || !current.reportsTo) return;

    await updateRequestState(tx, ctx.organizationId, requestId, {
      state: 'escalated',
      currentApproverId: current.reportsTo,
      slaDueAt: computeSlaDueAt(now),
      escalationCount: locked.escalationCount + 1,
      blockedReason: null,
    });
    await insertApprovalAudit(tx, ctx, 'approval.escalated', requestId,
      { approverId: locked.currentApproverId, state: locked.state },
      { approverId: current.reportsTo, state: 'escalated', escalationCount: locked.escalationCount + 1, at: now.toISOString() },
    );
  });
  const refreshed = await findRequest(ctx, requestId);
  if (!refreshed) throw new ApprovalNotFoundError();
  return refreshed;
}

export async function getRequest(ctx: RequestContext, id: string): Promise<ApprovalRequest> {
  const row = await findRequest(ctx, id);
  if (!row) throw new ApprovalNotFoundError();
  return row;
}

export async function listPendingForDealQuery(ctx: RequestContext, dealId: string): Promise<ApprovalRequest | null> {
  return findPendingForDeal(ctx, dealId);
}

export { loadApprovalResource };

export async function visibleRequestsFilter(ctx: RequestContext): Promise<readonly ApprovalRequest[]> {
  const scope = await visibilityFilter(ctx, 'approvals:decide', 'approvalRequest');
  return listPendingWithScope(ctx, scope);
}
