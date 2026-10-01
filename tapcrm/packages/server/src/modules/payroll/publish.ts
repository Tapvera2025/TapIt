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
  monthLabel,
} from './errors.js';
import { PAYROLL_EVENTS, type RunPublished } from './events.js';
import { breakEvaluationRequired, employeesInPeriod, freezeEmployees } from './freeze.js';
import { getRunById, getRunEmployees, populationChange, transitionRun } from './run.js';
import { buildRunPostingIntent, type SlipComponent } from './posting.js';
import { notifyPayslipsPublished } from './notifications.js';

export interface PublishBlocker {
  /** Null for a blocker on the whole run (its settings changed). */
  readonly userId: string | null;
  readonly workDate: string | null;
  readonly kind: string;
  readonly sourceId: string | null;
}

export interface PublishResult {
  readonly status: 'published';
  readonly publishedAt: string;
  readonly payslips: number;
}

/** The gross, deductions and employer cost of a set of slips, as balanced ledger components. */
export function slipComponents(totals: {
  readonly grossPaise: bigint;
  readonly deductionsPaise: bigint;
  readonly employerContributionPaise: bigint;
}): SlipComponent[] {
  return [
    // Salary expense is the gross; what is owed to people is the gross less deductions.
    { code: 'gross', kind: 'earning', amountPaise: totals.grossPaise, debitRole: 'salary-expense', creditRole: 'salary-payable' },
    { code: 'deductions', kind: 'deduction', amountPaise: totals.deductionsPaise, debitRole: 'salary-payable', creditRole: 'statutory-liability' },
    {
      code: 'employer-contributions',
      kind: 'employer-contribution',
      amountPaise: totals.employerContributionPaise,
      debitRole: 'employer-contribution-expense',
      creditRole: 'statutory-liability',
    },
  ];
}

/**
 * Publication: §14.6 / Task 5.
 *
 * 1. Lock the run, then the included people in ascending UUID order.
 * 2. Re-read everything live after the locks: attendance and break blockers,
 *    the settings, the population and every employee's inputs. Any difference
 *    from the frozen run is a named blocker, and nothing is published.
 * 3. Publish all draft slips (immutable, revision 0).
 * 4. Write the balanced posting intent via the accounting facade.
 * 5. Mark the run published and write the `payroll.published` outbox event.
 */
export async function publishRun(
  ctx: RequestContext,
  runId: string,
): Promise<PublishResult> {
  return db.transaction(ctx, async (tx) => {
    const run = await getRunById(tx, runId);
    if (!run || run.organizationId !== ctx.organizationId) {
      throw new PayrollNotFoundError('Payroll run not found');
    }
    const month = monthLabel(run.periodStart);
    if (run.status === 'published') {
      throw new PayrollConflictError(
        PAYROLL_ERROR_CODES.ALREADY_PUBLISHED,
        `Payroll for ${month} is already published.`,
        { publishedAt: run.publishedAt },
      );
    }
    if (run.status !== 'review') {
      throw new PayrollConflictError(
        PAYROLL_ERROR_CODES.WRONG_STATUS,
        `The ${month} run is ${run.status}; only a run in review can be published.`,
        { status: run.status },
      );
    }

    await transitionRun(tx, runId, ctx.organizationId, 'review', 'publishing');

    const employees = await getRunEmployees(tx, runId, ctx.organizationId);
    const userIds = employees.map((e) => e.userId);
    for (const uid of [...userIds].sort()) {
      await AttFacade.lockPerson(tx, uid);
    }

    // Re-read live inputs after the locks.
    const from = run.periodStart as DateOnly;
    const to = run.periodEnd as DateOnly;
    const breakEvaluation = await breakEvaluationRequired(tx, ctx.organizationId);
    const liveOpen = await AttFacade.openItems(tx, userIds, from, to, { breakEvaluation });
    const unresolvedBreaches = await BreakFacade.unresolvedBreaches(tx, userIds, from, to);

    const blockers: PublishBlocker[] = [
      ...liveOpen.map((o) => ({ userId: o.userId, workDate: o.workDate ?? null, kind: o.kind, sourceId: o.sourceId })),
      ...unresolvedBreaches.map((b) => ({ userId: b.userId, workDate: b.workDate ?? null, kind: `break:${b.kind}`, sourceId: b.id })),
    ];

    const config = await resolveConfig(tx, ctx.organizationId, run.periodStart);
    const live = await employeesInPeriod(tx, ctx.organizationId, run.periodStart, run.periodEnd);
    const change = populationChange(userIds, live.map((e) => e.userId));
    for (const userId of change.joined) blockers.push({ userId, workDate: null, kind: 'joined-after-freeze', sourceId: null });
    for (const userId of change.left) blockers.push({ userId, workDate: null, kind: 'left-after-freeze', sourceId: null });

    if (!config || config.id !== run.configId) {
      blockers.push({ userId: null, workDate: null, kind: 'settings-changed', sourceId: config?.id ?? null });
    } else {
      const frozenFingerprints = new Map(employees.map((e) => [e.userId, e.inputsFingerprint]));
      const stillIncluded = live.filter((e) => frozenFingerprints.has(e.userId));
      const current = await freezeEmployees(
        tx,
        ctx.organizationId,
        { start: run.periodStart, end: run.periodEnd },
        config,
        stillIncluded,
      );
      for (const emp of current) {
        if (emp.fingerprint !== frozenFingerprints.get(emp.userId)) {
          blockers.push({ userId: emp.userId, workDate: null, kind: 'inputs-changed', sourceId: null });
        }
      }
    }

    if (blockers.length > 0) throw new PublishBlockedError(blockers);

    // Every employee has the draft slip computed from exactly their frozen inputs.
    const slips = await tx.query<{
      id: string; userId: string; inputsFingerprint: string;
      grossPaise: string; deductionsPaise: string; netPaise: string;
      employerContributionPaise: string;
    }>(sql`
      SELECT id, user_id AS "userId", inputs_fingerprint AS "inputsFingerprint",
             gross_paise::text AS "grossPaise", deductions_paise::text AS "deductionsPaise",
             net_paise::text AS "netPaise", employer_contribution_paise::text AS "employerContributionPaise"
      FROM payslip
      WHERE organization_id = ${ctx.organizationId}
        AND run_id = ${runId}::uuid
        AND status = 'draft'
      ORDER BY user_id
    `);
    for (const emp of employees) {
      const slip = slips.find((s) => s.userId === emp.userId);
      if (!slip || slip.inputsFingerprint !== emp.inputsFingerprint) {
        throw new PayrollConflictError(
          PAYROLL_ERROR_CODES.MISSING_SLIP,
          'Some payslips are missing or out of date. Recalculate the run, then publish.',
          { userId: emp.userId },
        );
      }
    }

    // Publish all slips — claim revision 0 under the person-period lock.
    const publishedAt = new Date().toISOString();
    for (const slip of slips) {
      const existing = await tx.maybeOne<{ id: string }>(sql`
        SELECT id FROM payslip
        WHERE organization_id = ${ctx.organizationId}
          AND user_id = ${slip.userId}::uuid
          AND period_start = ${run.periodStart}::date
          AND status = 'published'
      `);
      if (existing) {
        throw new PayrollConflictError(
          PAYROLL_ERROR_CODES.ALREADY_PUBLISHED,
          `A payslip for ${month} is already published for one of these employees. Revise it instead.`,
          { userId: slip.userId, payslipId: existing.id },
        );
      }
      await tx.query(sql`
        UPDATE payslip
        SET status = 'published', immutable = true, published_at = now(), revision_number = 0
        WHERE id = ${slip.id}::uuid AND organization_id = ${ctx.organizationId}
      `);
    }

    const totals = slips.reduce(
      (sum, s) => ({
        grossPaise: sum.grossPaise + BigInt(s.grossPaise),
        deductionsPaise: sum.deductionsPaise + BigInt(s.deductionsPaise),
        employerContributionPaise: sum.employerContributionPaise + BigInt(s.employerContributionPaise),
      }),
      { grossPaise: 0n, deductionsPaise: 0n, employerContributionPaise: 0n },
    );
    const intent = buildRunPostingIntent(slipComponents(totals).filter((c) => c.amountPaise > 0n));
    await post(tx, {
      organizationId: ctx.organizationId,
      runId,
      payslipId: null,
      kind: intent.kind,
      lines: intent.lines,
      debitTotalPaise: intent.debitTotalPaise,
      creditTotalPaise: intent.creditTotalPaise,
    });

    await tx.query(sql`
      UPDATE payroll_run SET status = 'published', published_at = now(), inputs_changed = false
      WHERE id = ${runId}::uuid AND organization_id = ${ctx.organizationId}
    `);

    const event: RunPublished = {
      runId,
      periodStart: run.periodStart,
      publishedAt,
      payslips: slips.map((s) => ({ payslipId: s.id, userId: s.userId })),
    };
    await tx.query(sql`
      INSERT INTO domain_outbox (organization_id, event_name, payload)
      VALUES (${ctx.organizationId}, ${PAYROLL_EVENTS.PUBLISHED}, ${JSON.stringify(event)}::jsonb)
    `);
    await writePayrollAudit(tx, ctx, {
      action: 'payroll.run-published',
      targetType: 'payrollRun',
      targetId: runId,
      before: { status: 'review' },
      after: { status: 'published', periodStart: run.periodStart, payslips: slips.length },
    });
    await notifyPayslipsPublished(tx, ctx, { id: runId, periodStart: run.periodStart }, slips.map((s) => s.userId));

    return { status: 'published', publishedAt, payslips: slips.length };
  });
}

export class PublishBlockedError extends Error {
  constructor(readonly blockers: PublishBlocker[]) {
    super('PAYROLL_NOT_PUBLISHABLE: ' + JSON.stringify(blockers.map(b => b.kind)));
    this.name = 'PublishBlockedError';
  }
}

/** Remember on the run that its inputs moved, so the screen can offer a recalculation. */
export async function markInputsChanged(ctx: RequestContext, runId: string): Promise<void> {
  await db.transaction(ctx, (tx) =>
    tx.query(sql`
      UPDATE payroll_run SET inputs_changed = true
      WHERE organization_id = ${ctx.organizationId} AND id = ${runId}::uuid AND status = 'review'
    `),
  );
}
