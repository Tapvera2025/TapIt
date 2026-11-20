/**
 * Sales v1.1 R2 — Deals service (R2 plan step 2.7).
 *
 * CRUD + stage transitions + lifecycle terminals. The Won recorder in
 * step 2.14 is the sole writer of `(deal_stage='closed', lifecycle='won')`;
 * nothing here lets a client reach that state.
 */

import { authorize, effectivePolicy, visibilityFilter } from '@tapcrm/authz';
import { globalAccess } from '@tapcrm/contracts';
import { ApplicationError } from '../../../errors.js';
import type { RequestContext } from '../../../platform/dal/context.js';
import { db, type Tx } from '../../../platform/dal/db.js';
import { PlatformForbiddenError, PlatformNotFoundError } from '../../../platform/errors.js';
import { sql } from '../../../platform/dal/sql.js';
import { findOrInsertCompanyByName } from '../intake/repository.js';
import { cancelOpenCallbacksInTransaction, leadNotConvertibleReason } from '../leads/lifecycle.js';
import { HANDED_OVER_MESSAGE, isHandedOverAway } from '../handover/policy.js';
import { insertActivity, insertAudit, loadLeadResource } from '../leads/repository.js';
import { openPostingPeriodCoversTx, postSourceJournalTx } from '../../finance/facade.js';
import { NOTIFICATION_TYPES, notify } from '../../notifications/facade.js';
import { notifyDealMilestone } from './notifications.js';
import {
  findBriefForDealTx,
  findProjectPeopleTx,
  insertBriefAudit,
  markCancelled as markBriefCancelled,
} from '../delivery/repository.js';
import { getCurrencySettings } from '../../organization/facade.js';
import { organizationToday } from '../../../platform/organization-time.js';
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
  findLiveReceiptByReference,
  insertPaymentReceipt,
  revertLiveReceipt,
  setReceiptPosting,
  setReceiptReversal,
  findLiveReceiptForDealTx,
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

/** The named closer must be an active employee of this company. */
async function assertActiveEmployee(ctx: RequestContext, userId: string): Promise<void> {
  const row = await db.maybeOne<{ id: string }>(
    ctx,
    sql`SELECT id FROM app_user
         WHERE organization_id = ${ctx.organizationId} AND id = ${userId}
           AND account_type = 'employee' AND status = 'active'`,
  );
  if (!row) {
    throw new ApplicationError('The chosen closer is not an active employee.', 422, 'DEAL_CLOSER_INVALID');
  }
}

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
  // The agent who handed the lead over no longer works it, so they cannot
  // turn it into a deal either; the person who took it can.
  if (!globalAccess(ctx.principal) && isHandedOverAway(row, ctx.principal.id)) {
    throw new ApplicationError(HANDED_OVER_MESSAGE, 403, 'LEAD_HANDED_OVER');
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
    // Converting a lead is working it, so the caller must be allowed to edit
    // THIS lead: its holder, or someone whose scope reaches it. Without this
    // check any agent who knew a lead's id could convert a colleague's lead.
    const leadResource = await loadLeadResource(ctx, input.originatingLeadId);
    if (!leadResource) {
      throw new ApplicationError('Originating lead not found', 404, 'DEAL_LEAD_NOT_FOUND');
    }
    await authorize(ctx, 'leads:edit', leadResource);
    const lineage = await pullLeadLineage(ctx, input.originatingLeadId);
    originatingAgentId = lineage.originatingAgentId;
    responsibleCloserId = lineage.responsibleCloserId;
    if (input.responsibleCloserId !== undefined && input.responsibleCloserId !== responsibleCloserId) {
      // Naming a different closer moves the lead's work and its closer credit:
      // only someone who may reassign this lead can do that.
      await authorize(ctx, 'leads:reassign', leadResource);
      await assertActiveEmployee(ctx, input.responsibleCloserId);
      responsibleCloserId = input.responsibleCloserId;
    }
    if (!input.companyId && lineage.companyId) companyId = lineage.companyId;
    if (contactId !== undefined && lineage.contactId !== null && contactId !== lineage.contactId) {
      throw new ApplicationError(
        "A deal from a lead is with that lead's contact.",
        422,
        'DEAL_CONTACT_MISMATCH',
      );
    }
    if (!contactId && lineage.contactId) contactId = lineage.contactId;
  } else {
    // Direct entry — the caller is the originating agent and the responsible
    // closer. Only global access may enter a deal on someone else's behalf;
    // everyone else hands a deal over through reassignment.
    originatingAgentId = ctx.principal.id;
    responsibleCloserId = ctx.principal.id;
    if (input.responsibleCloserId !== undefined && input.responsibleCloserId !== ctx.principal.id) {
      if (!globalAccess(ctx.principal)) {
        throw new PlatformForbiddenError(
          'A deal entered directly is closed by the person who enters it.',
        );
      }
      await assertActiveEmployee(ctx, input.responsibleCloserId);
      responsibleCloserId = input.responsibleCloserId;
    }
  }
  if (!contactId) {
    throw new ApplicationError(
      'Contact could not be resolved — supply contactId or pick an originating lead that has one.',
      422,
      'DEAL_CONTACT_UNRESOLVED',
    );
  }

  const dealId = await db.transaction(ctx, async (tx) => {
    // Prevent a second deal from the same lead and transition the lead
    // atomically with the deal insert so the two cannot diverge.
    let lead: { status: string; companyId: string | null } | null = null;
    if (input.originatingLeadId) {
      const existing = await tx.maybeOne<{
        id: string;
        outcome: string;
        status: string;
        companyId: string | null;
        companyName: string | null;
      }>(sql`
        SELECT id, lead_outcome AS outcome, status::text AS status,
               company_id AS "companyId", company_name AS "companyName"
          FROM lead
         WHERE organization_id = ${ctx.organizationId}
           AND id              = ${input.originatingLeadId}
         FOR UPDATE
      `);
      if (existing && existing.outcome === 'converted') {
        throw new ApplicationError(
          'This lead has already been converted to a deal.',
          409,
          'DEAL_LEAD_ALREADY_CONVERTED',
        );
      }
      // Checked under the row lock, so a lead closed as lost a moment ago
      // cannot slip through.
      const notConvertible = existing ? leadNotConvertibleReason(existing.status) : null;
      if (notConvertible) {
        throw new ApplicationError(
          notConvertible,
          409,
          existing?.status === 'converted' ? 'DEAL_LEAD_ALREADY_CONVERTED' : 'DEAL_LEAD_NOT_CONVERTIBLE',
          { leadStatus: existing?.status },
        );
      }
      if (existing) {
        // A lead added by hand may hold its company only as a name.
        const leadCompanyId =
          existing.companyId ??
          (await findOrInsertCompanyByName(
            tx,
            ctx.organizationId,
            existing.companyName,
            ctx.principal.id,
          ));
        lead = { status: existing.status, companyId: leadCompanyId };
      }
    }
    const id = await insertDeal(tx, ctx.organizationId, {
      originatingLeadId: input.originatingLeadId ?? null,
      directEntryReason: input.directEntryReason ?? null,
      contactId,
      companyId: companyId ?? lead?.companyId ?? null,
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
    if (input.originatingLeadId) {
      // Flip the source lead to converted so operational counts and
      // outbound queues stop treating it as still-in-flight.
      await tx.query(sql`
        UPDATE lead
           SET status        = 'converted',
               lead_outcome  = 'converted',
               converted_at  = COALESCE(converted_at, now()),
               company_id    = COALESCE(company_id, ${lead?.companyId ?? null}::uuid),
               updated_at    = now()
         WHERE organization_id = ${ctx.organizationId}
           AND id              = ${input.originatingLeadId}
      `);
      await cancelOpenCallbacksInTransaction(
        tx,
        ctx,
        input.originatingLeadId,
        'lead_converted',
      );
      const { dealNumber } = await tx.one<{ dealNumber: string }>(sql`
        SELECT deal_number::text AS "dealNumber"
          FROM deal
         WHERE organization_id = ${ctx.organizationId} AND id = ${id}
      `);
      await insertActivity(
        tx,
        ctx.organizationId,
        input.originatingLeadId,
        'lead.converted',
        ctx.principal.id,
        {
          from: lead?.status ?? null,
          dealId: id,
          dealNumber,
          title: input.title,
        },
      );
      await insertAudit(
        tx,
        ctx,
        'lead.converted',
        input.originatingLeadId,
        { status: lead?.status ?? null },
        { status: 'converted', dealId: id },
      );
    }
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
    // R2-04: pending approval requests on a lost deal's commercials would
    // otherwise linger in the Approvals queue with no eligible approver.
    // Invalidate them atomically with the loss transition so the queue
    // reflects actionable work only. `approval_request` records the reason
    // in `blocked_reason`; `decided_by` must accompany `decided_at`.
    const cancelled = await tx.query<{ id: string }>(sql`
      UPDATE approval_request
         SET state          = 'invalidated',
             decided_at     = ${now},
             decided_by     = ${ctx.principal.id},
             blocked_reason = COALESCE(blocked_reason, 'Deal was marked lost; approval no longer required.'),
             updated_at     = ${now}
       WHERE organization_id = ${ctx.organizationId}
         AND deal_id         = ${id}
         AND state IN ('pending', 'escalated', 'returned')
       RETURNING id
    `);
    for (const row of cancelled) {
      await insertDealAudit(tx, ctx, 'approval.invalidated_on_deal_lost', row.id, { state: 'pending' }, { state: 'invalidated', dealId: id });
    }
  });
  const updated = await findDeal(ctx, id);
  if (!updated) throw new DealNotFoundError();
  return updated;
}

/** "INR 50,000.00" from minor units, without passing money through a JS number. */
function formatMinor(minor: string, currency: string): string {
  const value = BigInt(minor);
  const whole = value / 100n;
  const fraction = (value % 100n).toString().padStart(2, '0');
  return `${currency} ${whole.toLocaleString('en-IN')}.${fraction}`;
}

/**
 * What a cancelled win leaves behind, handled in the same transaction:
 *   - a delivery brief not yet accepted is cancelled, so nobody starts work;
 *   - a project already created from it is NOT stopped automatically (work may
 *     be billable, or wanted anyway): its people are told to decide;
 *   - an advance already received stays where it is in the books (a liability
 *     to the customer) and the people who confirm payments are told a refund
 *     decision is needed.
 * Sales targets and commissions are not implemented, so there is no credit to
 * reverse yet; when they land, this is where the reversal belongs.
 */
async function unwindWonDeal(
  tx: Tx,
  ctx: RequestContext,
  dealId: string,
  reason: string,
  now: Date,
): Promise<{ briefCancelled: boolean; projectId: string | null; refundDecisionNeeded: boolean }> {
  const deal = await findDealTx(tx, ctx.organizationId, dealId);
  const label = deal ? `#${deal.dealNumber}` : dealId;
  const brief = await findBriefForDealTx(tx, ctx.organizationId, dealId);

  let briefCancelled = false;
  if (brief && brief.state !== 'cancelled' && brief.state !== 'accepted') {
    await markBriefCancelled(tx, ctx.organizationId, brief.id, ctx.principal.id, `Deal cancelled after win: ${reason}`, now);
    await insertBriefAudit(tx, ctx, 'delivery.brief_cancelled', brief.id,
      { state: brief.state },
      { state: 'cancelled', reason: `Deal cancelled after win: ${reason}`, dealLifecycle: 'cancelled' },
    );
    briefCancelled = true;
  }

  const projectId = brief?.projectId ?? null;
  if (projectId) {
    const project = await findProjectPeopleTx(tx, ctx.organizationId, projectId);
    const people = (project?.userIds ?? []).filter((userId) => userId !== ctx.principal.id);
    if (project && people.length > 0) {
      await notify(tx, ctx, {
        type: NOTIFICATION_TYPES.DEAL_CANCELLED_AFTER_WIN,
        priority: 'operational',
        audience: { users: people },
        title: 'Deal cancelled: decide what happens to the project',
        body: `Deal ${label} was cancelled after it was won (${reason}). Decide whether "${project.name}" stops, pauses or continues.`,
        link: `/company/projects/${projectId}`,
        metadata: { dealId, projectId },
      });
    }
  }

  const receipt = await findLiveReceiptForDealTx(tx, ctx.organizationId, dealId);
  if (receipt) {
    await notify(tx, ctx, {
      type: NOTIFICATION_TYPES.DEAL_CANCELLED_AFTER_WIN,
      priority: 'operational',
      audience: { holders: { action: 'deals:confirm-payment' }, excludeUserIds: [ctx.principal.id] },
      title: 'Refund decision needed',
      body: `An advance of ${formatMinor(receipt.amountMinor, receipt.currency)} (ref ${receipt.reference}) was received on deal ${label}, which was cancelled after the win (${reason}). Decide whether it is refunded or kept under the contract.`,
      link: `/company/sales/deals/${dealId}`,
      metadata: { dealId, receiptId: receipt.id },
    });
  }

  return { briefCancelled, projectId, refundDecisionNeeded: receipt !== null };
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
    const cascade = await unwindWonDeal(tx, ctx, id, input.reason, now);
    await insertDealAudit(tx, ctx, 'deal.cancelled_after_win', id,
      { lifecycleStatus: 'won' },
      { lifecycleStatus: 'cancelled', reason: input.reason, at: now.toISOString(), ...cascade },
    );
  });
  const updated = await findDeal(ctx, id);
  if (!updated) throw new DealNotFoundError();
  return updated;
}

/**
 * Posts an advance (or its reversal) to the ledger when the ledger can take
 * it: the deal is in the company's own currency and an open accounting period
 * covers today. Otherwise nothing is posted and the returned note says why, so
 * the business action still succeeds and Finance sees what is waiting.
 */
async function postAdvanceJournal(
  tx: Tx,
  ctx: RequestContext,
  input: {
    sourceType: string;
    sourceId: string;
    description: string;
    amountMinor: bigint;
    currency: string;
    defaultCurrency: string;
    debit: string;
    credit: string;
  },
): Promise<{ journalId: string | null; note: string | null }> {
  if (input.currency !== input.defaultCurrency) {
    return {
      journalId: null,
      note: `Not posted: the deal is in ${input.currency}, the books in ${input.defaultCurrency}; post it with the exchange rate.`,
    };
  }
  const entryDate = await organizationToday(tx);
  if (!(await openPostingPeriodCoversTx(tx, ctx.organizationId, entryDate))) {
    return { journalId: null, note: `Not posted: no open accounting period covers ${entryDate}.` };
  }
  const result = await postSourceJournalTx(tx, {
    organizationId: ctx.organizationId,
    postedBy: ctx.principal.id,
    entryDate,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    description: input.description,
    lines: [
      { accountKey: input.debit, amountPaise: input.amountMinor, side: 'debit' },
      { accountKey: input.credit, amountPaise: input.amountMinor, side: 'credit' },
    ],
  });
  return { journalId: result.journalId, note: null };
}

/**
 * Separation of duties on a deal's money (PRD §4.2: Finance verifies the
 * receipt; the win is recorded by someone else). The person who sourced or is
 * closing a deal gains from it being paid and won, so they may neither confirm
 * its advance nor record its win, whatever their role, Super Admin included,
 * as for every other self-approval (A1 runs before the global bypass).
 */
export function assertNotOwnDealMoney(
  ctx: RequestContext,
  deal: { readonly responsibleCloserId: string; readonly originatingAgentId: string },
): void {
  if (deal.responsibleCloserId === ctx.principal.id || deal.originatingAgentId === ctx.principal.id) {
    throw new ApplicationError(
      'You sourced or are closing this deal, so its payment and win must be confirmed by someone else.',
      403,
      'DEAL_OWN_MONEY',
    );
  }
}

/**
 * Record a manual advance confirmation (or revert one). The route is
 * gated by `deals:confirm-payment` at the framework level, so this body
 * only enforces state semantics and the audit write.
 *
 * State transitions permitted:
 *   confirm: unpaid | partial -> advance_confirmed
 *   confirm: advance_confirmed -> advance_confirmed  (no-op, idempotent)
 *   revert:  advance_confirmed -> unpaid              (open deals only)
 *
 * The write never upgrades past `advance_confirmed` or touches refund
 * states; those remain the gateway integration's job.
 */
export async function confirmPayment(
  ctx: RequestContext,
  id: string,
  input: ConfirmPaymentInput,
): Promise<Deal> {
  if (input.revert === true) {
    return revertPaymentConfirmation(ctx, id, input.reason!);
  }
  return doConfirmPayment(ctx, id, {
    amountMinor: BigInt(input.amountMinor!),
    reference: input.reference!,
    note: input.note ?? null,
  });
}

async function doConfirmPayment(
  ctx: RequestContext,
  id: string,
  input: { amountMinor: bigint; reference: string; note: string | null },
): Promise<Deal> {
  const now = new Date();
  const { amountMinor } = input;
  const { defaultCurrency } = await getCurrencySettings(ctx);

  await db.transaction(ctx, async (tx) => {
    const locked = await lockDeal(tx, ctx.organizationId, id);
    if (!locked) throw new DealNotFoundError();
    assertNotOwnDealMoney(ctx, locked);

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
        { amountMinor: amountMinor.toString(), reference: input.reference, note: input.note },
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

    // The money is checked against what the customer was offered: a published
    // (or accepted) commercials version. Confirming an advance on a deal with
    // no agreed price used to skip the amount check altogether.
    const commercials = before.commercialsId
      ? await tx.maybeOne<{ advanceMinor: string; state: string }>(sql`
          SELECT advance_minor::text AS "advanceMinor", state
            FROM commercials
           WHERE organization_id = ${ctx.organizationId} AND id = ${before.commercialsId}
        `)
      : null;
    if (!commercials || (commercials.state !== 'published' && commercials.state !== 'accepted')) {
      throw new ApplicationError(
        'Publish the proposal (commercials) before confirming the advance, so the amount can be checked against it.',
        422,
        'DEAL_PAYMENT_NEEDS_COMMERCIALS',
      );
    }
    const expected = BigInt(commercials.advanceMinor);
    if (expected > 0n && amountMinor < expected) {
      throw new ApplicationError(
        `Confirmed amount (${amountMinor.toString()}) is below the expected advance (${expected.toString()}).`,
        422,
        'DEAL_PAYMENT_AMOUNT_INSUFFICIENT',
        { expectedAdvanceMinor: expected.toString(), suppliedAmountMinor: amountMinor.toString() },
      );
    }

    // One bank reference (UTR) backs one live receipt, on one deal. The unique
    // index in migration 0160 is the final guard against a concurrent reuse.
    const reused = await findLiveReceiptByReference(tx, ctx.organizationId, input.reference);
    if (reused) {
      throw new ApplicationError(
        reused.dealId === id
          ? 'This bank reference is already recorded for this deal.'
          : 'This bank reference is already recorded against another deal. Check the reference before confirming.',
        409,
        'DEAL_PAYMENT_REFERENCE_USED',
        { dealId: reused.dealId },
      );
    }

    await updatePaymentStatusRow(tx, ctx.organizationId, id, 'advance_confirmed', now, ctx.principal.id);
    const receiptId = await insertPaymentReceipt(tx, {
      organizationId: ctx.organizationId,
      dealId: id,
      amountMinor,
      currency: before.currency,
      reference: input.reference,
      note: input.note,
      confirmedBy: ctx.principal.id,
    });
    const posting = await postAdvanceJournal(tx, ctx, {
      sourceType: 'sales.deal.advance',
      sourceId: receiptId,
      description: `Advance received for deal #${before.dealNumber} (ref ${input.reference.trim()})`,
      amountMinor,
      currency: before.currency,
      defaultCurrency,
      debit: 'bank',
      credit: 'advances-from-customers',
    });
    await setReceiptPosting(tx, ctx.organizationId, receiptId, posting);
    await insertDealAudit(tx, ctx, 'deal.payment_confirmed', id,
      { paymentStatus: before.paymentStatus },
      {
        paymentStatus: 'advance_confirmed',
        amountMinor: amountMinor.toString(),
        reference: input.reference,
        note: input.note,
        receiptId,
        journalId: posting.journalId,
        postingNote: posting.note,
        at: now.toISOString(),
      },
    );
    await notifyDealMilestone(tx, ctx, locked, 'advanceConfirmed');
  });

  const updated = await findDeal(ctx, id);
  if (!updated) throw new DealNotFoundError();
  return updated;
}

/**
 * Revert an earlier advance confirmation. Open deals only — a confirmed
 * payment on a won deal is load-bearing for the readiness audit trail,
 * and ops must cancel-after-win to unwind that.
 */
async function revertPaymentConfirmation(
  ctx: RequestContext,
  id: string,
  reason: string,
): Promise<Deal> {
  const now = new Date();

  await db.transaction(ctx, async (tx) => {
    const locked = await lockDeal(tx, ctx.organizationId, id);
    if (!locked) throw new DealNotFoundError();

    const before = await findDealTx(tx, ctx.organizationId, id);
    if (!before) throw new DealNotFoundError();

    if (before.lifecycleStatus !== 'open') {
      throw new ApplicationError(
        `Deal lifecycle is ${before.lifecycleStatus}; payment confirmation can only be reverted on an open deal.`,
        409,
        'DEAL_PAYMENT_REVERT_WRONG_LIFECYCLE',
      );
    }

    if (before.paymentStatus !== 'advance_confirmed') {
      throw new ApplicationError(
        `Deal payment status is ${before.paymentStatus}; only advance_confirmed may be reverted.`,
        409,
        'DEAL_PAYMENT_REVERT_WRONG_STATUS',
      );
    }

    // Revert clears the initiator so the next confirmation can be done by
    // anyone, including the original confirmer. The audit trail still names
    // both the original confirmer and the reverter.
    await updatePaymentStatusRow(tx, ctx.organizationId, id, 'unpaid', now, null);
    // The receipt stays, marked reverted (its bank reference becomes free
    // again); a posted journal is reversed by an opposite one.
    const receipt = await revertLiveReceipt(tx, ctx.organizationId, id, ctx.principal.id, reason);
    if (receipt?.journalId) {
      const reversal = await postAdvanceJournal(tx, ctx, {
        sourceType: 'sales.deal.advance.reversal',
        sourceId: receipt.id,
        description: `Advance confirmation reverted for deal #${before.dealNumber}: ${reason}`,
        amountMinor: BigInt(receipt.amountMinor),
        currency: before.currency,
        // Only a posted receipt is reversed, so it was in the books' currency.
        defaultCurrency: before.currency,
        debit: 'advances-from-customers',
        credit: 'bank',
      });
      await setReceiptReversal(tx, ctx.organizationId, receipt.id, reversal.journalId);
    }
    await insertDealAudit(tx, ctx, 'deal.payment_reverted', id,
      { paymentStatus: 'advance_confirmed' },
      { paymentStatus: 'unpaid', reason, at: now.toISOString() },
    );
    await notifyDealMilestone(tx, ctx, locked, 'advanceReverted');
  });

  const updated = await findDeal(ctx, id);
  if (!updated) throw new DealNotFoundError();
  return updated;
}

export async function ensureDealExists(ctx: RequestContext, id: string): Promise<void> {
  const resource = await loadDealResource(ctx, id);
  if (!resource) throw new PlatformNotFoundError('Deal not found');
}
