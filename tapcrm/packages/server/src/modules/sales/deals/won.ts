/**
 * Sales v1.1 R2 — Won recorder (R2 plan step 2.14).
 *
 * The Won recorder is the **sole writer** of `(deal_stage='closed',
 * lifecycle_status='won')`. All other paths that could reach `closed`
 * throw `DEAL_CLOSED_STAGE_RESERVED` — see `state-machine.ts`.
 *
 * Close is atomic (R-DEAL-03):
 *   1. Lock the deal row.
 *   2. Re-run readiness inside the lock.
 *   3. Flip stage/lifecycle, stamp `won_at` + `closed_by_id`.
 *   4. Emit `sales.deal.won` to the audit outbox — downstream consumers
 *      (target achievements in R4, delivery-brief hooks) read from there
 *      so the recorder stays small and independent.
 *
 * Concurrency: two callers racing to close the same deal both acquire
 * `FOR UPDATE`; the second observes `lifecycle_status = 'won'` after the
 * first commits and gets a 409 `DEAL_ALREADY_WON`.
 */

import { ApplicationError } from '../../../errors.js';
import type { RequestContext } from '../../../platform/dal/context.js';
import { db } from '../../../platform/dal/db.js';
import { PlatformForbiddenError } from '../../../platform/errors.js';
import { effectivePolicy, visibilityFilter } from '@tapcrm/authz';
import { globalAccess } from '@tapcrm/contracts';
import { sql } from '../../../platform/dal/sql.js';
import { DealNotFoundError } from './service.js';
import { findDeal, insertDealAudit, lockDeal, markWonRow } from './repository.js';
import type { Deal } from './types.js';
import { evaluateReadiness, readinessForClose, type ReadinessReport } from './won-readiness.js';

export class DealAlreadyWonError extends ApplicationError {
  constructor(dealId: string) {
    super('Deal has already been recorded as won.', 409, 'DEAL_ALREADY_WON', { dealId });
    this.name = 'DealAlreadyWonError';
  }
}

export class DealCloseReadinessUnmetError extends ApplicationError {
  constructor(unmet: ReadinessReport['unmet']) {
    super(
      'Deal is not ready to close; see unmet conditions.',
      422,
      'WIN_READINESS_UNMET',
      { unmet },
    );
    this.name = 'DealCloseReadinessUnmetError';
  }
}

export { readinessForClose };
export type { ReadinessReport } from './won-readiness.js';

export async function recordWin(ctx: RequestContext, dealId: string): Promise<Deal> {
  // Fast-fail on authority outside the lock so we don't eat a row lock
  // for an unauthorized caller.
  if (!globalAccess(ctx.principal)) {
    const policy = await effectivePolicy(ctx, 'deals:record-win');
    if (!policy?.allowed) {
      throw new PlatformForbiddenError('Recording a win requires deals:record-win');
    }
  }

  const now = new Date();

  await db.transaction(ctx, async (tx) => {
    const locked = await lockDeal(tx, ctx.organizationId, dealId);
    if (!locked) throw new DealNotFoundError();
    if (locked.lifecycleStatus === 'won') {
      throw new DealAlreadyWonError(dealId);
    }
    if (locked.lifecycleStatus !== 'open') {
      throw new ApplicationError(
        `Deal lifecycle is ${locked.lifecycleStatus}; cannot be won.`,
        409,
        'DEAL_ALREADY_TERMINAL',
      );
    }

    // Re-run full readiness under the lock. The report already handles
    // the super-admin / `deals:record-win` check above, but we repeat it
    // here so the authority audit entry matches reality.
    const readiness = await evaluateReadiness(ctx, tx, dealId);
    if (!readiness.canClose) {
      throw new DealCloseReadinessUnmetError(readiness.unmet);
    }

    await markWonRow(tx, ctx.organizationId, dealId, ctx.principal.id, now);
    await insertDealAudit(tx, ctx, 'sales.deal.won', dealId,
      { lifecycleStatus: locked.lifecycleStatus, dealStage: locked.dealStage },
      {
        lifecycleStatus: 'won',
        dealStage: 'closed',
        wonAt: now.toISOString(),
        closedById: ctx.principal.id,
        originatingAgentId: locked.originatingAgentId,
        responsibleCloserId: locked.responsibleCloserId,
      },
    );
  });

  const won = await findDeal(ctx, dealId);
  if (!won) throw new DealNotFoundError();
  return won;
}

/**
 * The wins-to-record queue for the Sales Head / Super Admin: every open deal
 * in reach with a published proposal, the ones that are ready first. The
 * caller fetches detailed readiness per row and shows what is still missing.
 *
 * It used to list only deals whose approval and contract were already
 * through. A deal waiting on approval, on the advance or on its delivery
 * brief was then invisible, so the page usually said "Nothing to record"
 * while deals were on their way to a win. `ready` is the cheap pre-check
 * (approval, contract, advance); the readiness report is the authority.
 */
export interface WinsToRecordRow {
  readonly id: string;
  readonly dealNumber: string;
  readonly title: string;
  readonly responsibleCloserId: string;
  readonly responsibleCloserName: string | null;
  readonly originatingAgentId: string;
  readonly contactName: string | null;
  readonly approvalStatus: string;
  readonly contractStatus: string;
  readonly paymentStatus: string;
  readonly commercialsId: string | null;
  readonly ready: boolean;
  readonly updatedAt: Date;
}

export async function listReadyToClose(ctx: RequestContext): Promise<readonly WinsToRecordRow[]> {
  const scope = await visibilityFilter(ctx, 'deals:record-win', 'deal');
  return db.query<WinsToRecordRow>(
    ctx,
    sql`SELECT q.*
          FROM (
            SELECT d.id,
                   d.deal_number::text        AS "dealNumber",
                   d.title,
                   d.responsible_closer_id    AS "responsibleCloserId",
                   closer.full_name           AS "responsibleCloserName",
                   d.originating_agent_id     AS "originatingAgentId",
                   contact.full_name          AS "contactName",
                   d.approval_status          AS "approvalStatus",
                   d.contract_status          AS "contractStatus",
                   d.payment_status           AS "paymentStatus",
                   d.commercials_id           AS "commercialsId",
                   (d.approval_status IN ('approved','not_required')
                    AND d.contract_status IN ('signed','not_required')
                    AND d.payment_status IN ('advance_confirmed','paid')) AS ready,
                   d.updated_at               AS "updatedAt"
              FROM deal d
              LEFT JOIN app_user closer
                ON closer.organization_id = d.organization_id AND closer.id = d.responsible_closer_id
              LEFT JOIN contact
                ON contact.organization_id = d.organization_id AND contact.id = d.contact_id
             WHERE d.organization_id = ${ctx.organizationId}
               AND d.lifecycle_status = 'open'
               AND d.commercials_id IS NOT NULL
               AND ${scope}
          ) q
         ORDER BY q.ready DESC, q."updatedAt" DESC
         LIMIT 200`,
  );
}
