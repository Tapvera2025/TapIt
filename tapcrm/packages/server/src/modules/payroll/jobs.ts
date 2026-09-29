import { sql } from '../../platform/dal/sql.js';
import { db } from '../../platform/dal/db.js';
import { defineJob, type JobHandle } from '../../platform/jobs/runner.js';
import { lockPerson } from '../attendance/facade.js';
import { transitionRun } from './run.js';
import { computeAndWriteDraftSlip, type FrozenEmployeeInputs } from './snapshot.js';
import { sweepPublishedPeriods } from './sweep.js';

export interface PayrollJobs {
  readonly computeEmployee: JobHandle<{ runId: string; userId: string; inputsFingerprint: string }>;
  readonly publishedPeriodSweep: JobHandle<undefined>;
}

export function registerPayrollJobs(): PayrollJobs {
  const computeJob = defineJob<{ runId: string; userId: string; inputsFingerprint: string }>({
    name: 'payroll.compute-employee',
    perOrganization: true,
    module: 'payroll',
    attempts: 3,
    handler: async ({ ctx, payload }) => {
      await db.transaction(ctx, async (tx) => {
        // Take person lock
        await lockPerson(tx, payload.userId);

        // Load employee row
        const rows = await tx.query<{
          id: string;
          runId: string;
          userId: string;
          inputs: FrozenEmployeeInputs;
          inputsFingerprint: string;
          status: string;
        }>(sql`
          SELECT id, run_id AS "runId", user_id AS "userId",
                 inputs, inputs_fingerprint AS "inputsFingerprint", status
          FROM payroll_run_employee
          WHERE organization_id = ${ctx.organizationId}
            AND run_id = ${payload.runId}::uuid
            AND user_id = ${payload.userId}::uuid
          FOR UPDATE
        `);
        const empRow = rows[0];
        if (!empRow) return; // Run cancelled or employee removed — no-op

        // Idempotency: if fingerprint changed, this is stale — skip
        if (empRow.inputsFingerprint !== payload.inputsFingerprint) return;
        if (empRow.status === 'computed') return;

        // Mark computing
        await tx.query(sql`
          UPDATE payroll_run_employee SET status = 'computing'
          WHERE id = ${empRow.id}::uuid
        `);

        // Load run to get period
        const run = await tx.maybeOne<{ periodStart: string; periodEnd: string; status: string }>(sql`
          SELECT period_start::text AS "periodStart", period_end::text AS "periodEnd", status
          FROM payroll_run WHERE id = ${payload.runId}::uuid AND organization_id = ${ctx.organizationId}
        `);
        if (!run || run.status === 'cancelled' || run.status === 'failed') return;

        await computeAndWriteDraftSlip(
          tx,
          ctx.organizationId,
          payload.runId,
          payload.userId,
          run.periodStart,
          run.periodEnd,
          empRow.inputs,
          empRow.inputsFingerprint,
        );

        await tx.query(sql`
          UPDATE payroll_run_employee SET status = 'computed', computed_at = now()
          WHERE id = ${empRow.id}::uuid
        `);

        // Check if all employees are now computed → transition to review or failed
        const remaining = await tx.maybeOne<{ pending: string; failed: string }>(sql`
          SELECT
            SUM(CASE WHEN status NOT IN ('computed','failed') THEN 1 ELSE 0 END) AS pending,
            SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
          FROM payroll_run_employee
          WHERE organization_id = ${ctx.organizationId} AND run_id = ${payload.runId}::uuid
        `);
        const pending = parseInt(remaining?.pending ?? '0', 10);
        const failed = parseInt(remaining?.failed ?? '0', 10);
        if (pending === 0) {
          const nextStatus = failed > 0 ? 'failed' : 'review';
          await transitionRun(tx, payload.runId, ctx.organizationId, 'computing', nextStatus);
        }
      });
      return { itemsProcessed: 1 };
    },
  });

  const ONE_HOUR_MS = 60 * 60 * 1000;

  const publishedPeriodSweepJob = defineJob({
    name: 'payroll.published-period-sweep',
    perOrganization: true,
    module: 'payroll',
    schedule: { every: ONE_HOUR_MS },
    attempts: 1, // next hour offers the same run; retries buy nothing
    handler: async ({ ctx }) => {
      const result = await sweepPublishedPeriods(ctx);
      return { itemsProcessed: result.opened, details: { scanned: result.scanned } };
    },
  });

  return { computeEmployee: computeJob, publishedPeriodSweep: publishedPeriodSweepJob };
}
