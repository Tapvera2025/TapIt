import type { RequestContext } from '../../platform/dal/context.js';
import { db } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import type { DateOnly } from '@tapcrm/contracts';
import * as AttFacade from '../attendance/facade.js';
import * as BreakFacade from '../break-management/facade.js';
import { post } from '../accounting/facade.js';
import { writePayrollAudit } from './audit.js';
import { resolveConfig } from './config.js';
import {
  PAYROLL_ERROR_CODES,
  PayrollConflictError,
  PayrollNotFoundError,
  PayrollValidationError,
  monthLabel,
} from './errors.js';
import { PAYROLL_EVENTS, type SlipRevised } from './events.js';
import { breakEvaluationRequired, freezeEmployees, type PeriodEmployee } from './freeze.js';
import { computeAndWriteDraftSlip } from './snapshot.js';
import { buildRevisionPostingIntent } from './posting.js';
import { slipComponents } from './publish.js';
import { notifyPayslipRevised } from './notifications.js';

export interface ReviseSlipInput {
  readonly slipId: string;
  readonly reason: string;
}

export interface ReviseSlipResult {
  readonly revisionSlipId: string;
  readonly revisionNumber: number;
  readonly previousNetPaise: string;
  readonly netPaise: string;
}

/**
 * Issue a linked revision for a published payslip (design §9, Task 6).
 * Freezes the person's current inputs for the month, recomputes, publishes the
 * result as revision n+1 linked to the latest published one, and posts the
 * signed difference. The original slip is never changed.
 */
export async function reviseSlip(
  ctx: RequestContext,
  input: ReviseSlipInput,
): Promise<ReviseSlipResult> {
  return db.transaction(ctx, async (tx) => {
    const sourceSlip = await tx.maybeOne<{
      id: string;
      userId: string;
      runId: string;
      periodStart: string;
      periodEnd: string;
      revisionNumber: number;
      status: string;
      inputsFingerprint: string;
      grossPaise: string;
      deductionsPaise: string;
      netPaise: string;
      employerContributionPaise: string;
    }>(sql`
      SELECT id, user_id AS "userId", run_id AS "runId",
             period_start::text AS "periodStart", period_end::text AS "periodEnd",
             revision_number AS "revisionNumber", status,
             inputs_fingerprint AS "inputsFingerprint",
             gross_paise::text AS "grossPaise", deductions_paise::text AS "deductionsPaise",
             net_paise::text AS "netPaise", employer_contribution_paise::text AS "employerContributionPaise"
      FROM payslip
      WHERE id = ${input.slipId}::uuid AND organization_id = ${ctx.organizationId}
      FOR UPDATE
    `);
    if (!sourceSlip) throw new PayrollNotFoundError('Payslip not found');
    if (sourceSlip.status !== 'published') {
      throw new PayrollConflictError(PAYROLL_ERROR_CODES.NOT_PUBLISHED, 'Only a published payslip can be revised.');
    }

    await AttFacade.lockPerson(tx, sourceSlip.userId);
    const month = monthLabel(sourceSlip.periodStart);

    const latest = await tx.one<{ id: string; revisionNumber: number }>(sql`
      SELECT id, revision_number AS "revisionNumber"
      FROM payslip
      WHERE organization_id = ${ctx.organizationId}
        AND user_id = ${sourceSlip.userId}::uuid
        AND period_start = ${sourceSlip.periodStart}::date
        AND status = 'published'
      ORDER BY revision_number DESC
      LIMIT 1
    `);
    if (latest.id !== sourceSlip.id) {
      throw new PayrollConflictError(
        PAYROLL_ERROR_CODES.WRONG_STATUS,
        `Revision ${latest.revisionNumber} is the current payslip for ${month}; revise that one instead.`,
        { currentSlipId: latest.id },
      );
    }

    const config = await resolveConfig(tx, ctx.organizationId, sourceSlip.periodStart);
    if (!config) {
      throw new PayrollValidationError(
        PAYROLL_ERROR_CODES.NO_CONFIG,
        `No payroll settings cover ${month} any more. Accept settings for it, then revise.`,
      );
    }

    const from = sourceSlip.periodStart as DateOnly;
    const to = sourceSlip.periodEnd as DateOnly;
    const breakEvaluation = await breakEvaluationRequired(tx, ctx.organizationId);
    const openItems = await AttFacade.openItems(tx, [sourceSlip.userId], from, to, { breakEvaluation });
    const breaches = await BreakFacade.unresolvedBreaches(tx, [sourceSlip.userId], from, to);
    if (openItems.length > 0 || breaches.length > 0) {
      throw new PayrollConflictError(
        PAYROLL_ERROR_CODES.NOT_PUBLISHABLE,
        `This person has ${openItems.length + breaches.length} open attendance or break item(s) in ${month}. Resolve them, then revise.`,
        {
          blockers: [
            ...openItems.map((o) => ({ kind: o.kind, workDate: o.workDate })),
            ...breaches.map((b) => ({ kind: `break:${b.kind}`, workDate: b.workDate })),
          ],
        },
      );
    }

    // The person's current window, even if it no longer overlaps the month:
    // a historical exit revises the slip down to nothing (design §9, Task 6).
    const person = await tx.maybeOne<{ fullName: string; accountStatus: string; joinedOn: string | null; leftOn: string | null }>(sql`
      SELECT full_name AS "fullName", status AS "accountStatus",
             joined_on::text AS "joinedOn", left_on::text AS "leftOn"
      FROM app_user
      WHERE organization_id = ${ctx.organizationId} AND id = ${sourceSlip.userId}::uuid
    `);
    if (!person) throw new PayrollNotFoundError('Employee not found');
    const employee: PeriodEmployee = {
      userId: sourceSlip.userId,
      ...person,
      employmentFrom: person.joinedOn ?? sourceSlip.periodStart,
      employmentTo: person.leftOn,
    };
    const [frozen] = await freezeEmployees(
      tx,
      ctx.organizationId,
      { start: sourceSlip.periodStart, end: sourceSlip.periodEnd },
      config,
      [employee],
    );
    if (frozen!.fingerprint === sourceSlip.inputsFingerprint) {
      throw new PayrollConflictError(
        PAYROLL_ERROR_CODES.NOT_PUBLISHABLE,
        `Nothing has changed for ${person.fullName} in ${month} since this payslip was published. ` +
          'Record the correction first (attendance, leave, salary or a payroll input), then revise.',
      );
    }

    const newRevisionNumber = latest.revisionNumber + 1;
    const { payslipId: draftSlipId } = await computeAndWriteDraftSlip(
      tx, ctx.organizationId, sourceSlip.runId, sourceSlip.userId,
      sourceSlip.periodStart, sourceSlip.periodEnd, frozen!.inputs, frozen!.fingerprint,
    );

    const draftSlip = await tx.one<{
      grossPaise: string;
      deductionsPaise: string;
      netPaise: string;
      employerContributionPaise: string;
    }>(sql`
      SELECT gross_paise::text AS "grossPaise", deductions_paise::text AS "deductionsPaise",
             net_paise::text AS "netPaise", employer_contribution_paise::text AS "employerContributionPaise"
      FROM payslip WHERE id = ${draftSlipId}::uuid
    `);

    await tx.query(sql`
      UPDATE payslip
      SET status = 'published', immutable = true, published_at = now(),
          revision_number = ${newRevisionNumber}, previous_slip_id = ${input.slipId}::uuid
      WHERE id = ${draftSlipId}::uuid AND organization_id = ${ctx.organizationId}
    `);

    const components = (slip: { grossPaise: string; deductionsPaise: string; employerContributionPaise: string }) =>
      slipComponents({
        grossPaise: BigInt(slip.grossPaise),
        deductionsPaise: BigInt(slip.deductionsPaise),
        employerContributionPaise: BigInt(slip.employerContributionPaise),
      });
    const deltaIntent = buildRevisionPostingIntent(components(sourceSlip), components(draftSlip));
    await post(tx, {
      organizationId: ctx.organizationId,
      runId: sourceSlip.runId,
      payslipId: draftSlipId,
      kind: deltaIntent.kind,
      lines: deltaIntent.lines,
      debitTotalPaise: deltaIntent.debitTotalPaise,
      creditTotalPaise: deltaIntent.creditTotalPaise,
    });

    const event: SlipRevised = {
      slipId: draftSlipId,
      userId: sourceSlip.userId,
      periodStart: sourceSlip.periodStart,
      revisionNumber: newRevisionNumber,
      reason: input.reason,
    };
    await tx.query(sql`
      INSERT INTO domain_outbox (organization_id, event_name, payload)
      VALUES (${ctx.organizationId}, ${PAYROLL_EVENTS.REVISED}, ${JSON.stringify(event)}::jsonb)
    `);
    await writePayrollAudit(tx, ctx, {
      action: 'payroll.payslip-revised',
      targetType: 'payslip',
      targetId: draftSlipId,
      before: { payslipId: sourceSlip.id, revisionNumber: sourceSlip.revisionNumber },
      after: { userId: sourceSlip.userId, periodStart: sourceSlip.periodStart, revisionNumber: newRevisionNumber },
      reason: input.reason,
    });
    await notifyPayslipRevised(tx, ctx, {
      id: draftSlipId,
      userId: sourceSlip.userId,
      periodStart: sourceSlip.periodStart,
      revisionNumber: newRevisionNumber,
    });

    return {
      revisionSlipId: draftSlipId,
      revisionNumber: newRevisionNumber,
      previousNetPaise: sourceSlip.netPaise,
      netPaise: draftSlip.netPaise,
    };
  });
}
