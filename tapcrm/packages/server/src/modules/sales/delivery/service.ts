/**
 * Sales v1.1 R2 — Delivery brief service (R2 plan step 2.15).
 *
 * State machine (R-DEL-02):
 *
 *   draft → submitted → (accepted | changes_requested | cancelled)
 *   changes_requested → draft (via updateBrief) → …
 *
 * Acceptance (R-DEL-04) requires an explicit `projectId` the caller
 * pre-created through the projects module. The link is idempotent on
 * the brief — a second accept with the same `projectId` returns the
 * existing accepted row; a second accept with a different `projectId`
 * is rejected with `BRIEF_PROJECT_LINK_EXISTS`.
 *
 * Cancellation after the deal is already `won` requires `deals:approve`;
 * routes gate the ordinary path on `delivery:approve` and this guard
 * fires inside the service when the lifecycle flag is set.
 */

import type { Resource } from '@tapcrm/authz';
import { effectivePolicy } from '@tapcrm/authz';
import { globalAccess } from '@tapcrm/contracts';
import { ApplicationError } from '../../../errors.js';
import type { RequestContext } from '../../../platform/dal/context.js';
import { db } from '../../../platform/dal/db.js';
import { PlatformForbiddenError } from '../../../platform/errors.js';
import { sql } from '../../../platform/dal/sql.js';
import {
  checkProjectExists,
  findBrief,
  findBriefForDeal,
  findBriefForDealTx,
  findBriefTx,
  insertBrief,
  insertBriefAudit,
  loadCommercials,
  loadDealContext,
  lockBrief,
  markAccepted,
  markCancelled,
  markChangesRequested,
  markSubmitted,
  updateBriefContent,
} from './repository.js';
import type { DeliveryBrief, DeliveryBriefContent } from './types.js';
import type {
  ReviewDecisionInput,
  StartBriefInput,
  UpdateBriefInput,
} from './validators.js';

export class DeliveryBriefNotFoundError extends ApplicationError {
  constructor() {
    super('Delivery brief not found', 404, 'DELIVERY_BRIEF_NOT_FOUND');
    this.name = 'DeliveryBriefNotFoundError';
  }
}

export class DeliveryBriefWrongStateError extends ApplicationError {
  constructor(state: string, allowed: readonly string[]) {
    super(
      `Delivery brief is ${state}; expected one of ${allowed.join(', ')}.`,
      409,
      'DELIVERY_BRIEF_WRONG_STATE',
      { state, allowed },
    );
    this.name = 'DeliveryBriefWrongStateError';
  }
}

export class DeliveryBriefOptimisticLockError extends ApplicationError {
  constructor(expected: Date, actual: Date, serverCopy: DeliveryBrief) {
    super(
      'Delivery brief was modified since you loaded it; refresh and retry.',
      409,
      'DELIVERY_BRIEF_STALE_WRITE',
      {
        expectedUpdatedAt: expected.toISOString(),
        actualUpdatedAt: actual.toISOString(),
        serverCopy,
      },
    );
    this.name = 'DeliveryBriefOptimisticLockError';
  }
}

export class DeliveryBriefProjectLinkExistsError extends ApplicationError {
  constructor(projectId: string) {
    super(
      'Brief is already linked to a different project; one brief → one project (R-DEL-04).',
      409,
      'BRIEF_PROJECT_LINK_EXISTS',
      { projectId },
    );
    this.name = 'DeliveryBriefProjectLinkExistsError';
  }
}

export class DeliveryBriefAlreadyExistsError extends ApplicationError {
  constructor(briefId: string) {
    super(
      'A delivery brief already exists for this deal.',
      409,
      'DELIVERY_BRIEF_ALREADY_EXISTS',
      { briefId },
    );
    this.name = 'DeliveryBriefAlreadyExistsError';
  }
}

export async function loadDealForBrief(ctx: RequestContext, briefId: string): Promise<Resource | null> {
  // The brief routes declare `delivery:view` / `delivery:approve` which
  // the registry types as `resource: 'delivery'`. We return a resource
  // of that type so the delivery-brief policy evaluates — not the deal
  // policy (which would hand pool scope the wrong semantics for a
  // Delivery reviewer who isn't the Sales closer).
  const row = await db.maybeOne<{
    id: string;
    organizationId: string;
    responsibleCloserId: string;
    originatingAgentId: string;
  }>(
    ctx,
    sql`SELECT b.id,
               b.organization_id       AS "organizationId",
               d.responsible_closer_id AS "responsibleCloserId",
               d.originating_agent_id  AS "originatingAgentId"
          FROM delivery_brief b
          JOIN deal d ON d.organization_id = b.organization_id AND d.id = b.deal_id
         WHERE b.organization_id = ${ctx.organizationId} AND b.id = ${briefId}`,
  );
  if (!row) return null;
  const resource: Resource & {
    type: 'delivery';
    responsibleCloserId: string;
    originatingAgentId: string;
  } = {
    type: 'delivery',
    id: row.id,
    organizationId: row.organizationId,
    responsibleCloserId: row.responsibleCloserId,
    originatingAgentId: row.originatingAgentId,
  };
  return resource;
}

export async function getBrief(ctx: RequestContext, id: string): Promise<DeliveryBrief> {
  const row = await findBrief(ctx, id);
  if (!row) throw new DeliveryBriefNotFoundError();
  return row;
}

export async function getBriefForDeal(ctx: RequestContext, dealId: string): Promise<DeliveryBrief | null> {
  return findBriefForDeal(ctx, dealId);
}

export async function startBrief(
  ctx: RequestContext,
  dealId: string,
  input: StartBriefInput,
): Promise<DeliveryBrief> {
  const briefId = await db.transaction(ctx, async (tx) => {
    const deal = await loadDealContext(tx, ctx.organizationId, dealId);
    if (!deal) throw new ApplicationError('Deal not found', 404, 'DEAL_NOT_FOUND');

    const existing = await findBriefForDealTx(tx, ctx.organizationId, dealId);
    if (existing) {
      throw new DeliveryBriefAlreadyExistsError(existing.id);
    }

    const commercials = await loadCommercials(tx, ctx.organizationId, input.commercialsId);
    if (!commercials) {
      throw new ApplicationError('Commercials not found', 404, 'COMMERCIALS_NOT_FOUND');
    }
    if (commercials.dealId !== dealId) {
      throw new ApplicationError(
        'Commercials belongs to a different deal.',
        422,
        'BRIEF_COMMERCIALS_MISMATCH',
      );
    }

    const content: DeliveryBriefContent = input.content ?? {};
    const id = await insertBrief(tx, ctx.organizationId, {
      dealId,
      commercialsId: input.commercialsId,
      content,
      createdBy: ctx.principal.id,
    });
    await insertBriefAudit(tx, ctx, 'delivery.brief_created', id, null, {
      dealId,
      commercialsId: input.commercialsId,
    });
    return id;
  });

  const created = await findBrief(ctx, briefId);
  if (!created) throw new DeliveryBriefNotFoundError();
  return created;
}

export async function updateBrief(
  ctx: RequestContext,
  briefId: string,
  input: UpdateBriefInput,
): Promise<DeliveryBrief> {
  const now = new Date();

  await db.transaction(ctx, async (tx) => {
    const locked = await lockBrief(tx, ctx.organizationId, briefId);
    if (!locked) throw new DeliveryBriefNotFoundError();
    if (locked.state !== 'draft' && locked.state !== 'changes_requested') {
      throw new DeliveryBriefWrongStateError(locked.state, ['draft', 'changes_requested']);
    }
    const expected = input.expectedUpdatedAt.getTime();
    const actual = locked.updatedAt.getTime();
    if (expected !== actual) {
      const serverCopy = await findBriefTx(tx, ctx.organizationId, briefId);
      if (!serverCopy) throw new DeliveryBriefNotFoundError();
      throw new DeliveryBriefOptimisticLockError(input.expectedUpdatedAt, locked.updatedAt, serverCopy);
    }
    const content = (input.content ?? {}) as DeliveryBriefContent;
    await updateBriefContent(tx, ctx.organizationId, briefId, content, now);
    await insertBriefAudit(tx, ctx, 'delivery.brief_updated', briefId,
      { state: locked.state },
      { state: locked.state, sections: Object.keys(content).length },
    );
  });

  const updated = await findBrief(ctx, briefId);
  if (!updated) throw new DeliveryBriefNotFoundError();
  return updated;
}

export async function submit(ctx: RequestContext, briefId: string): Promise<DeliveryBrief> {
  const now = new Date();

  await db.transaction(ctx, async (tx) => {
    const locked = await lockBrief(tx, ctx.organizationId, briefId);
    if (!locked) throw new DeliveryBriefNotFoundError();
    if (locked.state !== 'draft' && locked.state !== 'changes_requested') {
      throw new DeliveryBriefWrongStateError(locked.state, ['draft', 'changes_requested']);
    }
    await markSubmitted(tx, ctx.organizationId, briefId, now);
    await insertBriefAudit(tx, ctx, 'delivery.brief_submitted', briefId,
      { state: locked.state },
      { state: 'submitted' },
    );
  });

  const updated = await findBrief(ctx, briefId);
  if (!updated) throw new DeliveryBriefNotFoundError();
  return updated;
}

export async function reviewDecision(
  ctx: RequestContext,
  briefId: string,
  input: ReviewDecisionInput,
): Promise<DeliveryBrief> {
  const now = new Date();

  await db.transaction(ctx, async (tx) => {
    const locked = await lockBrief(tx, ctx.organizationId, briefId);
    if (!locked) throw new DeliveryBriefNotFoundError();

    if (input.decision === 'accept') {
      // Idempotent (R-DEL-04): a repeat accept with the same projectId
      // on an already-accepted brief is a no-op; a different projectId
      // is rejected.
      if (locked.state === 'accepted') {
        if (locked.projectId === input.projectId) {
          return;
        }
        throw new DeliveryBriefProjectLinkExistsError(locked.projectId ?? '');
      }
      if (locked.state !== 'submitted' && locked.state !== 'changes_requested') {
        throw new DeliveryBriefWrongStateError(locked.state, ['submitted', 'changes_requested']);
      }
      const project = await checkProjectExists(tx, ctx.organizationId, input.projectId);
      if (!project) {
        throw new ApplicationError(
          'Project not found; create the project before linking a delivery brief.',
          404,
          'PROJECT_NOT_FOUND',
        );
      }
      await markAccepted(tx, ctx.organizationId, briefId, ctx.principal.id, input.projectId, now);
      await insertBriefAudit(tx, ctx, 'delivery.brief_accepted', briefId,
        { state: locked.state },
        { state: 'accepted', projectId: input.projectId },
      );
      return;
    }

    if (input.decision === 'request_changes') {
      if (locked.state !== 'submitted') {
        throw new DeliveryBriefWrongStateError(locked.state, ['submitted']);
      }
      await markChangesRequested(
        tx,
        ctx.organizationId,
        briefId,
        ctx.principal.id,
        input.changeNotes,
        now,
      );
      await insertBriefAudit(tx, ctx, 'delivery.brief_changes_requested', briefId,
        { state: 'submitted' },
        { state: 'changes_requested', changeNotes: input.changeNotes },
      );
      return;
    }

    // cancel
    if (locked.state === 'cancelled' || locked.state === 'accepted') {
      throw new DeliveryBriefWrongStateError(locked.state, ['draft', 'submitted', 'changes_requested']);
    }
    const deal = await loadDealContext(tx, ctx.organizationId, locked.dealId);
    if (deal && deal.lifecycleStatus === 'won' && !globalAccess(ctx.principal)) {
      // R-DEL-02 — cancelling after Win requires the deal:approve action.
      const policy = await effectivePolicy(ctx, 'deals:approve');
      if (!policy?.allowed) {
        throw new PlatformForbiddenError('Cancelling a delivery brief after Win requires deals:approve');
      }
    }
    await markCancelled(tx, ctx.organizationId, briefId, ctx.principal.id, input.reason, now);
    await insertBriefAudit(tx, ctx, 'delivery.brief_cancelled', briefId,
      { state: locked.state },
      { state: 'cancelled', reason: input.reason, dealLifecycle: deal?.lifecycleStatus ?? null },
    );
  });

  const updated = await findBrief(ctx, briefId);
  if (!updated) throw new DeliveryBriefNotFoundError();
  return updated;
}
