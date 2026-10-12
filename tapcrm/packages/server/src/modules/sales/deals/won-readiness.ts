/**
 * Sales v1.1 R2 — Readiness computation for close-won (R2 plan step 2.14).
 *
 * Produces a structured report of every condition for closing a deal.
 * The UI (wins-to-record queue) deep-links each unmet row to a resolver
 * action; the recordWin command re-runs this exact check inside its lock.
 *
 * Checks (R-WIN-01):
 *   - approval          : approval_status ∈ {not_required, approved}
 *   - contract          : latest contract state ∈ {signed} OR
 *                         contract_status === 'not_required'
 *   - payment           : delegated to the pluggable PaymentReadinessPort
 *                         (`payments-port.ts`). Default = satisfied.
 *   - delivery_brief    : a `delivery_brief` row exists in state ≥ draft
 *   - authority         : actor is super-admin OR holds deals:record-win
 */

import type { RequestContext } from '../../../platform/dal/context.js';
import { db, type Tx } from '../../../platform/dal/db.js';
import { effectivePolicy } from '@tapcrm/authz';
import { globalAccess } from '@tapcrm/contracts';
import { sql } from '../../../platform/dal/sql.js';
import { paymentReadinessPort } from './payments-port.js';

export const CLOSE_READINESS_CONDITIONS = [
  'approval',
  'contract',
  'payment',
  'delivery_brief',
  'authority',
  'already_closed',
  'already_terminal',
] as const;
export type CloseReadinessCondition = (typeof CLOSE_READINESS_CONDITIONS)[number];

export interface UnmetCondition {
  readonly condition: CloseReadinessCondition;
  readonly description: string;
  readonly resolver: string;
}

export interface ReadinessReport {
  readonly canClose: boolean;
  readonly unmet: readonly UnmetCondition[];
}

interface DealReadinessSnapshot {
  readonly id: string;
  readonly dealStage: string;
  readonly approvalStatus: string;
  readonly contractStatus: string;
  readonly lifecycleStatus: string;
  readonly commercialsId: string | null;
}

async function loadSnapshot(
  tx: Tx,
  organizationId: string,
  dealId: string,
): Promise<DealReadinessSnapshot | null> {
  return tx.maybeOne<DealReadinessSnapshot>(sql`
    SELECT id,
           deal_stage       AS "dealStage",
           approval_status  AS "approvalStatus",
           contract_status  AS "contractStatus",
           lifecycle_status AS "lifecycleStatus",
           commercials_id   AS "commercialsId"
      FROM deal
     WHERE organization_id = ${organizationId}
       AND id              = ${dealId}
  `);
}

interface ContractSnapshot {
  readonly state: string;
}

async function loadActiveContract(
  tx: Tx,
  organizationId: string,
  dealId: string,
): Promise<ContractSnapshot | null> {
  return tx.maybeOne<ContractSnapshot>(sql`
    SELECT state
      FROM contract
     WHERE organization_id = ${organizationId}
       AND deal_id         = ${dealId}
       AND state NOT IN ('amended','replaced','voided')
     ORDER BY created_at DESC
     LIMIT 1
  `);
}

interface BriefSnapshot {
  readonly state: string;
}

async function loadBrief(
  tx: Tx,
  organizationId: string,
  dealId: string,
): Promise<BriefSnapshot | null> {
  return tx.maybeOne<BriefSnapshot>(sql`
    SELECT state
      FROM delivery_brief
     WHERE organization_id = ${organizationId}
       AND deal_id         = ${dealId}
  `);
}

/**
 * Evaluate readiness. Called both by the public `readinessForClose`
 * endpoint and inside the Won recorder's transaction — the latter passes
 * its own `tx`, the former uses a short-lived read.
 */
export async function evaluateReadiness(
  ctx: RequestContext,
  tx: Tx,
  dealId: string,
): Promise<ReadinessReport> {
  const unmet: UnmetCondition[] = [];

  const deal = await loadSnapshot(tx, ctx.organizationId, dealId);
  if (!deal) {
    return {
      canClose: false,
      unmet: [{
        condition: 'already_closed',
        description: 'Deal not found.',
        resolver: 'Check the deal id.',
      }],
    };
  }

  if (deal.lifecycleStatus === 'won') {
    return {
      canClose: false,
      unmet: [{
        condition: 'already_closed',
        description: 'Deal is already recorded as won.',
        resolver: 'No action needed; this deal is closed.',
      }],
    };
  }
  if (deal.lifecycleStatus !== 'open') {
    return {
      canClose: false,
      unmet: [{
        condition: 'already_terminal',
        description: `Deal lifecycle is ${deal.lifecycleStatus}; terminal states cannot be re-closed.`,
        resolver: 'Reopen the deal through the authorized reversal path, or create a new deal.',
      }],
    };
  }

  // 1. Approval readiness.
  if (deal.approvalStatus !== 'approved' && deal.approvalStatus !== 'not_required') {
    unmet.push({
      condition: 'approval',
      description: `Approval status is ${deal.approvalStatus}; it must be 'approved' or 'not_required' before close.`,
      resolver: deal.approvalStatus === 'pending'
        ? 'Ask the current approver to decide the pending request.'
        : 'Create a new commercials version and submit for approval.',
    });
  }

  // 2. Contract readiness. Latest live contract must be signed, unless
  // the deal explicitly flags contract_status = 'not_required'.
  if (deal.contractStatus === 'not_required') {
    // satisfied
  } else {
    const activeContract = await loadActiveContract(tx, ctx.organizationId, dealId);
    if (!activeContract) {
      unmet.push({
        condition: 'contract',
        description: 'No active contract exists for this deal.',
        resolver: 'Create a contract draft from the published commercials and record its signature.',
      });
    } else if (activeContract.state !== 'signed') {
      unmet.push({
        condition: 'contract',
        description: `Active contract is ${activeContract.state}; signed evidence is required to close.`,
        resolver: activeContract.state === 'sent'
          ? 'Record the signed artefact and signer evidence.'
          : 'Send the contract to the signer and capture the signature.',
      });
    }
  }

  // 3. Payment readiness — delegated to the port (default allows close).
  const paymentResult = await paymentReadinessPort().evaluate(
    tx,
    ctx.organizationId,
    dealId,
    deal.commercialsId,
  );
  if (!paymentResult.satisfied) {
    unmet.push({
      condition: 'payment',
      description: paymentResult.description,
      resolver: 'Verify and allocate the required advance against this deal.',
    });
  }

  // 4. Delivery brief must at least exist as a draft (R-WIN-02 says a
  // brief + onboarding task is produced on win; R-DEAL-03 requires the
  // "agreed scope ready" check).
  const brief = await loadBrief(tx, ctx.organizationId, dealId);
  if (!brief) {
    unmet.push({
      condition: 'delivery_brief',
      description: 'No delivery brief exists yet.',
      resolver: 'Start a delivery brief from the deal page.',
    });
  } else if (brief.state === 'cancelled') {
    unmet.push({
      condition: 'delivery_brief',
      description: 'The delivery brief is cancelled; close is blocked.',
      resolver: 'Create a fresh delivery brief or reopen the previous one.',
    });
  }

  // 5. Authority — super-admin or `deals:record-win`. We check here so
  // the UI can grey out the button for ineligible users; the recorder
  // re-checks after locking.
  if (!globalAccess(ctx.principal)) {
    const policy = await effectivePolicy(ctx, 'deals:record-win');
    if (!policy?.allowed) {
      unmet.push({
        condition: 'authority',
        description: 'Only users with deals:record-win may close deals (Sales HOD by default).',
        resolver: 'Hand off to the Sales HOD / Super Admin to record the win.',
      });
    }
  }

  return { canClose: unmet.length === 0, unmet };
}

/** Convenience wrapper for the HTTP route — opens a tiny read-only tx. */
export async function readinessForClose(ctx: RequestContext, dealId: string): Promise<ReadinessReport> {
  return db.transaction(ctx, (tx) => evaluateReadiness(ctx, tx, dealId));
}
