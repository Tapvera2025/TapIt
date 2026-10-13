/**
 * Sales v1.1 R2 — Deals service (R2 plan step 2.7).
 *
 * CRUD + stage transitions + lifecycle terminals. The Won recorder in
 * step 2.14 is the sole writer of `(deal_stage='closed', lifecycle='won')`;
 * nothing here lets a client reach that state.
 */

import { effectivePolicy, visibilityFilter } from '@tapcrm/authz';
import { globalAccess } from '@tapcrm/contracts';
import { ApplicationError } from '../../../errors.js';
import type { RequestContext } from '../../../platform/dal/context.js';
import { db } from '../../../platform/dal/db.js';
import { PlatformForbiddenError, PlatformNotFoundError } from '../../../platform/errors.js';
import { sql } from '../../../platform/dal/sql.js';
import {
  DEAL_ERROR_CODES,
  DealStateError,
  assertLifecycleTransition,
  assertStageTransition,
} from './state-machine.js';
import { isValidProbabilityOverride } from './probability.js';
import {
  findDeal,
  findDealTx,
  insertDeal,
  insertDealAudit,
  listDealsRows,
  loadDealResource,
  lockDeal,
  markCancelledRow,
  markLostRow,
  updateDealStage as updateDealStageRow,
  updatePaymentStatusRow,
  updateProbabilityOverride,
  type DealPage,
} from './repository.js';
import type {
  CancelAfterWinInput,
  ConfirmPaymentInput,
  CreateDealInput,
  DealListQuery,
  MarkLostInput,
  OverrideProbabilityInput,
  UpdateDealStageInput,
} from './validators.js';
import type { Deal } from './types.js';

export class DealNotFoundError extends ApplicationError {
  constructor() {
    super('Deal not found', 404, 'DEAL_NOT_FOUND');
    this.name = 'DealNotFoundError';
  }
}

export const loadDeal = loadDealResource;

async function pullLeadLineage(ctx: RequestContext, leadId: string): Promise<{
  originatingAgentId: string;
  responsibleCloserId: string;
  companyId: string | null;
  contactId: string | null;
}> {
  const row = await db.maybeOne<{
    originatingAgentId: string | null;
    currentHolderId: string | null;
    ownerId: string | null;
    companyId: string | null;
    contactId: string | null;
  }>(
    ctx,
    sql`SELECT originating_agent_id AS "originatingAgentId",
               current_holder_id    AS "currentHolderId",
               owner_id             AS "ownerId",
               company_id           AS "companyId",
               contact_id           AS "contactId"
          FROM lead
         WHERE organization_id = ${ctx.organizationId} AND id = ${leadId}`,
  );
  if (!row) {
    throw new ApplicationError('Originating lead not found', 404, 'DEAL_LEAD_NOT_FOUND');
  }
  const originatingAgentId = row.originatingAgentId ?? row.ownerId ?? row.currentHolderId;
  const responsibleCloserId = row.currentHolderId ?? row.ownerId ?? row.originatingAgentId;
  if (!originatingAgentId || !responsibleCloserId) {
    throw new ApplicationError(
      'Originating lead has no claimed owner — claim or route the lead before creating a deal',
      422,
      'DEAL_LEAD_UNROUTED',
    );
  }
  return {
    originatingAgentId,
    responsibleCloserId,
    companyId: row.companyId,
    contactId: row.contactId,
  };
}

export async function createDeal(ctx: RequestContext, input: CreateDealInput): Promise<Deal> {
  let originatingAgentId: string;
  let responsibleCloserId: string;
  let companyId: string | null = input.companyId ?? null;
  let contactId: string | undefined = input.contactId;

  if (input.originatingLeadId) {
    const lineage = await pullLeadLineage(ctx, input.originatingLeadId);
    originatingAgentId = lineage.originatingAgentId;
    responsibleCloserId = input.responsibleCloserId ?? lineage.responsibleCloserId;
    if (!input.companyId && lineage.companyId) companyId = lineage.companyId;
    if (!contactId && lineage.contactId) contactId = lineage.contactId;
  } else {
    // Direct entry — the caller must be the originating agent, and
    // becomes the responsible closer by default.
    originatingAgentId = ctx.principal.id;
    responsibleCloserId = input.responsibleCloserId ?? ctx.principal.id;
  }
  if (!contactId) {
    throw new ApplicationError(
      'Contact could not be resolved — supply contactId or pick an originating lead that has one.',
      422,
      'DEAL_CONTACT_UNRESOLVED',
    );
  }

  const dealId = await db.transaction(ctx, async (tx) => {
    const id = await insertDeal(tx, ctx.organizationId, {
      originatingLeadId: input.originatingLeadId ?? null,
      directEntryReason: input.directEntryReason ?? null,
      contactId,
      companyId,
      serviceRequested: input.serviceRequested ?? null,
      title: input.title,
      scopeSummary: input.scopeSummary ?? null,
      originatingAgentId,
      responsibleCloserId,
      currency: input.currency,
      expectedCloseAt: input.expectedCloseAt ?? null,
      createdBy: ctx.principal.id,
    });
    await insertDealAudit(tx, ctx, 'deal.created', id, null, {
      originatingAgentId,
      responsibleCloserId,
      originatingLeadId: input.originatingLeadId ?? null,
      directEntryReason: input.directEntryReason ?? null,
    });
    return id;
  });

  const created = await findDeal(ctx, dealId);
  if (!created) throw new DealNotFoundError();
  return created;
}

export async function listDeals(ctx: RequestContext, query: DealListQuery): Promise<DealPage> {
  const scope = await visibilityFilter(ctx, 'deals:view', 'deal');
  return listDealsRows(
    ctx,
    scope,
    {
      ...(query.stage ? { stage: query.stage } : {}),
      ...(query.lifecycleStatus ? { lifecycleStatus: query.lifecycleStatus } : {}),
      ...(query.responsibleCloserId ? { responsibleCloserId: query.responsibleCloserId } : {}),
      ...(query.expectedCloseFrom ? { expectedCloseAfter: query.expectedCloseFrom } : {}),
      ...(query.expectedCloseTo ? { expectedCloseBefore: query.expectedCloseTo } : {}),
      ...(query.search ? { search: query.search } : {}),
    },
    query.page,
    query.pageSize,
  );
}

export async function getDeal(ctx: RequestContext, id: string): Promise<Deal> {
  const deal = await findDeal(ctx, id);
  if (!deal) throw new DealNotFoundError();
  return deal;
}

export async function updateDealStage(ctx: RequestContext, id: string, input: UpdateDealStageInput): Promise<Deal> {
  const now = new Date();
  await db.transaction(ctx, async (tx) => {
    const locked = await lockDeal(tx, ctx.organizationId, id);
    if (!locked) throw new DealNotFoundError();
    if (locked.lifecycleStatus !== 'open') {
      throw new DealStateError(
        DEAL_ERROR_CODES.ALREADY_TERMINAL,
        `Deal lifecycle is ${locked.lifecycleStatus}; cannot change stage.`,
      );
    }
    assertStageTransition(locked.dealStage, input.dealStage);
    if (locked.dealStage === input.dealStage) return;              // no-op

    await updateDealStageRow(tx, ctx.organizationId, id, input.dealStage);
    await insertDealAudit(tx, ctx, 'deal.stage_changed', id,
      { dealStage: locked.dealStage },
      { dealStage: input.dealStage, at: now.toISOString() },
    );
  });
  const updated = await findDeal(ctx, id);
  if (!updated) throw new DealNotFoundError();
  return updated;
}

export async function overrideProbability(
  ctx: RequestContext,
  id: string,
  input: OverrideProbabilityInput,
): Promise<Deal> {
  if (!isValidProbabilityOverride(input.probability)) {
    throw new ApplicationError('Probability must be between 0 and 100', 422, 'DEAL_INVALID_PROBABILITY');
  }
  if (!globalAccess(ctx.principal)) {
    const policy = await effectivePolicy(ctx, 'deals:forecast');
    if (!policy?.allowed) {
      throw new PlatformForbiddenError('Overriding probability requires deals:forecast');
    }
  }

  await db.transaction(ctx, async (tx) => {
    const locked = await lockDeal(tx, ctx.organizationId, id);
    if (!locked) throw new DealNotFoundError();
    if (locked.lifecycleStatus !== 'open') {
      throw new DealStateError(DEAL_ERROR_CODES.ALREADY_TERMINAL, 'Only open deals may have probability overrides.');
    }
    const before = await findDealTx(tx, ctx.organizationId, id);
    await updateProbabilityOverride(tx, ctx.organizationId, id, input.probability);
    await insertDealAudit(tx, ctx, 'deal.probability_overridden', id,
      { probabilityOverride: before?.probabilityOverride ?? null },
      { probabilityOverride: input.probability, reason: input.reason },
    );
  });

  const updated = await findDeal(ctx, id);
  if (!updated) throw new DealNotFoundError();
  return updated;
}

export async function markLost(ctx: RequestContext, id: string, input: MarkLostInput): Promise<Deal> {
  const now = new Date();
  await db.transaction(ctx, async (tx) => {
    const locked = await lockDeal(tx, ctx.organizationId, id);
    if (!locked) throw new DealNotFoundError();
    assertLifecycleTransition(locked.lifecycleStatus, 'lost');
    await markLostRow(tx, ctx.organizationId, id, input.reason, now);
    await insertDealAudit(tx, ctx, 'deal.lost', id,
      { lifecycleStatus: locked.lifecycleStatus },
      { lifecycleStatus: 'lost', lossReason: input.reason, note: input.note ?? null, at: now.toISOString() },
    );
  });
  const updated = await findDeal(ctx, id);
  if (!updated) throw new DealNotFoundError();
  return updated;
}

export async function cancelAfterWin(ctx: RequestContext, id: string, input: CancelAfterWinInput): Promise<Deal> {
  if (!globalAccess(ctx.principal)) {
    const policy = await effectivePolicy(ctx, 'deals:approve');
    if (!policy?.allowed) {
      throw new PlatformForbiddenError('Cancelling after win requires deals:approve');
    }
  }
  const now = new Date();
  await db.transaction(ctx, async (tx) => {
    const locked = await lockDeal(tx, ctx.organizationId, id);
    if (!locked) throw new DealNotFoundError();
    if (locked.lifecycleStatus !== 'won') {
      throw new DealStateError(DEAL_ERROR_CODES.CANCEL_REQUIRES_WON, 'Only won deals may be cancelled with this path.');
    }
    await markCancelledRow(tx, ctx.organizationId, id, now);
    await insertDealAudit(tx, ctx, 'deal.cancelled_after_win', id,
      { lifecycleStatus: 'won' },
      { lifecycleStatus: 'cancelled', reason: input.reason, at: now.toISOString() },
    );
  });
  const updated = await findDeal(ctx, id);
  if (!updated) throw new DealNotFoundError();
  return updated;
}

/**
 * Record a manual advance confirmation. The route is gated by
 * `deals:confirm-payment` (Finance / Sales HOD) at the framework level,
 * so this body only enforces state semantics and the audit write.
 *
 * State transitions permitted here:
 *   unpaid | partial -> advance_confirmed
 *   advance_confirmed -> advance_confirmed  (no-op, idempotent)
 *
 * The write never upgrades past `advance_confirmed` or touches refund
 * states; those remain the gateway integration's job.
 */
export async function confirmPayment(
  ctx: RequestContext,
  id: string,
  input: ConfirmPaymentInput,
): Promise<Deal> {
  const now = new Date();
  const amountMinor = BigInt(input.amountMinor);

  await db.transaction(ctx, async (tx) => {
    const locked = await lockDeal(tx, ctx.organizationId, id);
    if (!locked) throw new DealNotFoundError();

    const before = await findDealTx(tx, ctx.organizationId, id);
    if (!before) throw new DealNotFoundError();

    if (before.lifecycleStatus !== 'open' && before.lifecycleStatus !== 'won') {
      throw new ApplicationError(
        `Deal lifecycle is ${before.lifecycleStatus}; advance can only be confirmed on open or won deals.`,
        409,
        'DEAL_PAYMENT_WRONG_LIFECYCLE',
      );
    }

    if (before.paymentStatus === 'advance_confirmed') {
      // Idempotent — a second confirmation on an already-confirmed deal
      // audits the attempt but doesn't change state.
      await insertDealAudit(tx, ctx, 'deal.payment_confirmation_repeated', id,
        { paymentStatus: before.paymentStatus },
        { amountMinor: amountMinor.toString(), reference: input.reference, note: input.note ?? null },
      );
      return;
    }

    if (before.paymentStatus === 'paid'
      || before.paymentStatus === 'partially_refunded'
      || before.paymentStatus === 'refunded') {
      throw new ApplicationError(
        `Deal payment status is ${before.paymentStatus}; cannot downgrade to advance_confirmed.`,
        409,
        'DEAL_PAYMENT_DOWNGRADE_BLOCKED',
      );
    }

    await updatePaymentStatusRow(tx, ctx.organizationId, id, 'advance_confirmed', now);
    await insertDealAudit(tx, ctx, 'deal.payment_confirmed', id,
      { paymentStatus: before.paymentStatus },
      {
        paymentStatus: 'advance_confirmed',
        amountMinor: amountMinor.toString(),
        reference: input.reference,
        note: input.note ?? null,
        at: now.toISOString(),
      },
    );
  });

  const updated = await findDeal(ctx, id);
  if (!updated) throw new DealNotFoundError();
  return updated;
}

export async function ensureDealExists(ctx: RequestContext, id: string): Promise<void> {
  const resource = await loadDealResource(ctx, id);
  if (!resource) throw new PlatformNotFoundError('Deal not found');
}
