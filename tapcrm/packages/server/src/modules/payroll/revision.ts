import type { RequestContext } from '../../platform/dal/context.js';
import { db } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import type { DateOnly } from '@tapcrm/contracts';
import * as AttFacade from '../attendance/facade.js';
import * as BreakFacade from '../break-management/facade.js';
import { post } from '../accounting/facade.js';
import { computeAndWriteDraftSlip, type FrozenEmployeeInputs } from './snapshot.js';
import { buildRevisionPostingIntent, type SlipComponent } from './posting.js';
import { fingerprint } from './run.js';
import { listActiveInputsForPeriod } from './input.js';
import { resolveStructureForDate } from './structure.js';
import { resolveConfig } from './config.js';
import { PAYROLL_EVENTS } from './events.js';
import type { FrozenStructureSegment } from './calculate.js';

export interface ReviseSlipInput {
  readonly slipId: string;
  readonly reason: string;
}

/**
 * Issue a linked revision for a published payslip.
 * Freezes current inputs, recomputes, posts delta intent, links revision.
 */
export async function reviseSlip(
  ctx: RequestContext,
  input: ReviseSlipInput,
): Promise<{ revisionSlipId: string; revisionNumber: number }> {
  return db.transaction(ctx, async (tx) => {
    // Lock the source slip
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
    if (!sourceSlip) throw new Error('PAYROLL_NOT_FOUND: Slip not found');
    if (sourceSlip.status !== 'published') throw new Error('PAYROLL_NOT_PUBLISHED: Can only revise published slips');

    await AttFacade.lockPerson(tx, sourceSlip.userId);

    // Re-freeze current inputs
    const config = await resolveConfig(tx, ctx.organizationId, sourceSlip.periodStart);
    if (!config) throw new Error('PAYROLL_NO_CONFIG');

    const structure = await resolveStructureForDate(tx, ctx.organizationId, sourceSlip.userId, sourceSlip.periodEnd);
    const activeInputs = await listActiveInputsForPeriod(tx, ctx.organizationId, [sourceSlip.userId], sourceSlip.periodStart);
    const snapshot = await AttFacade.snapshotPeriod(
      tx,
      [sourceSlip.userId],
      sourceSlip.periodStart as DateOnly,
      sourceSlip.periodEnd as DateOnly,
    );

    const openItems = await AttFacade.openItems(
      tx,
      [sourceSlip.userId],
      sourceSlip.periodStart as DateOnly,
      sourceSlip.periodEnd as DateOnly,
    );
    const breaches = await BreakFacade.unresolvedBreaches(
      tx,
      [sourceSlip.userId],
      sourceSlip.periodStart as DateOnly,
      sourceSlip.periodEnd as DateOnly,
    );

    if (openItems.length > 0 || breaches.length > 0) {
      throw new Error('PAYROLL_NOT_PUBLISHABLE: Cannot revise with open blockers');
    }

    const frozenInputs: FrozenEmployeeInputs = {
      employmentFrom: sourceSlip.periodStart,
      employmentTo: null,
      days: snapshot.days.filter(d => d.userId === sourceSlip.userId),
      structureSegments: structure ? [structure as unknown as FrozenStructureSegment] : [],
      payrollInputs: activeInputs,
      configSnapshot: { id: config.id, effectiveFrom: config.effectiveFrom, settings: config.settings },
    };
    const newFingerprint = fingerprint(frozenInputs);

    // Claim next revision number (under person-period lock)
    const maxRev = await tx.maybeOne<{ maxRev: number }>(sql`
      SELECT COALESCE(MAX(revision_number), -1) AS "maxRev"
      FROM payslip
      WHERE organization_id = ${ctx.organizationId}
        AND user_id = ${sourceSlip.userId}::uuid
        AND period_start = ${sourceSlip.periodStart}::date
        AND status = 'published'
    `);
    const newRevisionNumber = (maxRev?.maxRev ?? -1) + 1;

    // Compute and write draft revision
    const { payslipId: draftSlipId } = await computeAndWriteDraftSlip(
      tx, ctx.organizationId, sourceSlip.runId, sourceSlip.userId,
      sourceSlip.periodStart, sourceSlip.periodEnd, frozenInputs, newFingerprint,
    );

    // Get the computed draft totals
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

    // Publish the revision: link to source, set revision number
    await tx.query(sql`
      UPDATE payslip
      SET status = 'published', immutable = true, published_at = now(),
          revision_number = ${newRevisionNumber}, previous_slip_id = ${input.slipId}::uuid
      WHERE id = ${draftSlipId}::uuid AND organization_id = ${ctx.organizationId}
    `);

    // Build delta posting intent
    const prevComponents: SlipComponent[] = [{
      code: 'net',
      kind: 'earning',
      amountPaise: BigInt(sourceSlip.netPaise),
      debitRole: 'salary-expense',
      creditRole: 'salary-payable',
    }];
    const newComponents: SlipComponent[] = [{
      code: 'net',
      kind: 'earning',
      amountPaise: BigInt(draftSlip.netPaise),
      debitRole: 'salary-expense',
      creditRole: 'salary-payable',
    }];
    const deltaIntent = buildRevisionPostingIntent(prevComponents, newComponents);

    await post(tx, {
      organizationId: ctx.organizationId,
      runId: sourceSlip.runId,
      payslipId: draftSlipId,
      kind: deltaIntent.kind,
      lines: deltaIntent.lines,
      debitTotalPaise: deltaIntent.debitTotalPaise,
      creditTotalPaise: deltaIntent.creditTotalPaise,
    });

    // Write audit outbox event
    await tx.query(sql`
      INSERT INTO domain_outbox (organization_id, event_name, payload)
      VALUES (${ctx.organizationId}, ${PAYROLL_EVENTS.REVISED},
              ${JSON.stringify({ slipId: draftSlipId, userId: sourceSlip.userId, revisionNumber: newRevisionNumber, reason: input.reason })}::jsonb)
    `);

    return { revisionSlipId: draftSlipId, revisionNumber: newRevisionNumber };
  });
}
