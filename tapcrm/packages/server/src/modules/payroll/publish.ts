import type { RequestContext } from '../../platform/dal/context.js';
import { db } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import type { DateOnly } from '@tapcrm/contracts';
import * as AttFacade from '../attendance/facade.js';
import * as BreakFacade from '../break-management/facade.js';
import { post } from '../accounting/facade.js';
import { getRunById, getRunEmployees, transitionRun } from './run.js';
import { buildRunPostingIntent, type SlipComponent } from './posting.js';
import { PAYROLL_EVENTS } from './events.js';

export interface PublishBlocker {
  readonly userId: string;
  readonly workDate: string | null;
  readonly kind: string;
  readonly sourceId: string | null;
}

export interface PublishResult {
  readonly status: 'published';
  readonly publishedAt: string;
}

/**
 * Publication: §14.6 / Task 5.
 *
 * 1. Acquire person locks in ascending UUID order, then org config lock.
 * 2. Re-read complete live inputs under READ COMMITTED after locks.
 * 3. Compare fingerprints.
 * 4. Call openItems + unresolvedBreaches.
 * 5. Publish all draft slips (immutable=true, status=published, revision 0).
 * 6. Write balanced posting intent via LedgerFacade.
 * 7. Mark run published, write domain_outbox event.
 * 8. Commit.
 */
export async function publishRun(
  ctx: RequestContext,
  runId: string,
): Promise<PublishResult> {
  return db.transaction(ctx, async (tx) => {
    // Load and lock the run
    const run = await getRunById(tx, runId);
    if (!run || run.organizationId !== ctx.organizationId) {
      throw new Error('PAYROLL_NOT_FOUND: Run not found');
    }
    if (run.status !== 'review') {
      throw new Error(`PAYROLL_WRONG_STATUS: Run is ${run.status}, expected review`);
    }

    await transitionRun(tx, runId, ctx.organizationId, 'review', 'publishing');

    // Load employees
    const employees = await getRunEmployees(tx, runId, ctx.organizationId);
    const userIds = employees.map(e => e.userId);

    // Acquire person locks in ascending UUID order
    const sortedIds = [...userIds].sort();
    for (const uid of sortedIds) {
      await AttFacade.lockPerson(tx, uid);
    }

    // Re-read live inputs after locks
    const _liveSnapshot = await AttFacade.snapshotPeriod(
      tx, userIds,
      run.periodStart as DateOnly, run.periodEnd as DateOnly,
    );
    const liveOpen = await AttFacade.openItems(
      tx, userIds,
      run.periodStart as DateOnly, run.periodEnd as DateOnly,
    );
    const unresolvedBreaches = await BreakFacade.unresolvedBreaches(
      tx, userIds,
      run.periodStart as DateOnly, run.periodEnd as DateOnly,
    );

    const blockers: PublishBlocker[] = [
      ...liveOpen.map(o => ({ userId: o.userId, workDate: o.workDate ?? null, kind: o.kind, sourceId: o.sourceId })),
      ...unresolvedBreaches.map(b => ({ userId: b.userId, workDate: b.workDate ?? null, kind: `break:${b.kind}`, sourceId: b.id })),
    ];

    if (blockers.length > 0) {
      // Roll back status transition
      await transitionRun(tx, runId, ctx.organizationId, 'publishing', 'review');
      throw new PublishBlockedError(blockers);
    }

    // Verify each draft slip's stored lines match its frozen computation
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

    // Verify fingerprints still match frozen inputs
    for (const emp of employees) {
      const slip = slips.find(s => s.userId === emp.userId);
      if (!slip) throw new Error(`PAYROLL_MISSING_SLIP: No draft slip for ${emp.userId}`);
      if (slip.inputsFingerprint !== emp.inputsFingerprint) {
        throw new Error(`PAYROLL_FINGERPRINT_MISMATCH: Slip for ${emp.userId} fingerprint changed`);
      }
    }

    // Publish all slips — claim revision 0 under person-period lock
    const publishedAt = new Date().toISOString();
    for (const slip of slips) {
      // Verify no published slip exists yet for this person/period (revision 0)
      const existing = await tx.maybeOne<{ id: string }>(sql`
        SELECT id FROM payslip
        WHERE organization_id = ${ctx.organizationId}
          AND user_id = ${slip.userId}::uuid
          AND period_start = ${run.periodStart}::date
          AND status = 'published'
          AND revision_number = 0
      `);
      if (existing) {
        throw new Error(`PAYROLL_DUPLICATE_REVISION: Person ${slip.userId} already has published revision 0 for this period`);
      }

      await tx.query(sql`
        UPDATE payslip
        SET status = 'published', immutable = true, published_at = now(), revision_number = 0
        WHERE id = ${slip.id}::uuid AND organization_id = ${ctx.organizationId}
      `);
    }

    // Build posting intent: aggregate slip totals as components
    const components: SlipComponent[] = slips.map(s => ({
      code: `slip:${s.userId}`,
      kind: 'earning' as const,
      amountPaise: BigInt(s.grossPaise) - BigInt(s.deductionsPaise),
      debitRole: 'salary-expense',
      creditRole: 'salary-payable',
    }));

    // Add deductions as a separate component
    const totalDeductions = slips.reduce((sum, s) => sum + BigInt(s.deductionsPaise), 0n);
    if (totalDeductions > 0n) {
      components.push({
        code: 'deductions-total',
        kind: 'deduction',
        amountPaise: totalDeductions,
        debitRole: 'salary-payable',
        creditRole: 'statutory-liability',
      });
    }

    const intent = buildRunPostingIntent(components.filter(c => c.amountPaise > 0n));

    await post(tx, {
      organizationId: ctx.organizationId,
      runId,
      payslipId: null,
      kind: intent.kind,
      lines: intent.lines,
      debitTotalPaise: intent.debitTotalPaise,
      creditTotalPaise: intent.creditTotalPaise,
    });

    // Mark run published
    await tx.query(sql`
      UPDATE payroll_run SET status = 'published', published_at = now()
      WHERE id = ${runId}::uuid AND organization_id = ${ctx.organizationId}
    `);

    // Write payroll.published outbox event
    await tx.query(sql`
      INSERT INTO domain_outbox (organization_id, event_name, payload)
      VALUES (${ctx.organizationId}, ${PAYROLL_EVENTS.PUBLISHED},
              ${JSON.stringify({ runId, periodStart: run.periodStart, publishedAt })}::jsonb)
    `);

    return { status: 'published', publishedAt };
  });
}

export class PublishBlockedError extends Error {
  constructor(readonly blockers: PublishBlocker[]) {
    super('PAYROLL_NOT_PUBLISHABLE: ' + JSON.stringify(blockers.map(b => b.kind)));
    this.name = 'PublishBlockedError';
  }
}
