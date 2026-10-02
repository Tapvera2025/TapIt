import { createJobContext, systemPrincipal, type RequestContext } from '../../platform/dal/context.js';
import { db, type Tx } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import { defineJob, type JobHandle } from '../../platform/jobs/runner.js';
import { onOutboxEvent } from '../../platform/outbox/registry.js';
import { lockPerson } from '../attendance/facade.js';
import { PAYROLL_EVENTS, type RunStarted } from './events.js';
import { computeAndWriteDraftSlip, type FrozenEmployeeInputs } from './snapshot.js';
import { sweepPublishedPeriods } from './sweep.js';

export interface ComputeEmployeePayload {
  readonly runId: string;
  readonly userId: string;
  readonly inputsFingerprint: string;
}

export interface PayrollJobs {
  readonly computeEmployee: JobHandle<ComputeEmployeePayload>;
  readonly publishedPeriodSweep: JobHandle<undefined>;
}

const COMPUTE_ATTEMPTS = 3;

/** The job key (design §9, Task 4): a changed input set is a different job. */
export function computeKey(payload: ComputeEmployeePayload): string {
  return `${payload.runId}:${payload.userId}:${payload.inputsFingerprint}`;
}

/**
 * When no employee is left pending, settle the run: review if every slip was
 * computed, failed if any employee failed. The run row is locked first, so two
 * workers finishing together cannot both see the other still computing.
 */
async function settleRunIfDone(tx: Tx, organizationId: string, runId: string): Promise<void> {
  const run = await tx.maybeOne<{ status: string }>(sql`
    SELECT status FROM payroll_run
    WHERE organization_id = ${organizationId} AND id = ${runId}::uuid
    FOR UPDATE
  `);
  if (!run || run.status !== 'computing') return;
  const counts = await tx.one<{ open: number; failed: number }>(sql`
    SELECT count(*) FILTER (WHERE status IN ('pending', 'computing'))::int AS open,
           count(*) FILTER (WHERE status = 'failed')::int AS failed
    FROM payroll_run_employee
    WHERE organization_id = ${organizationId} AND run_id = ${runId}::uuid
  `);
  if (counts.open > 0) return;
  await tx.query(sql`
    UPDATE payroll_run SET status = ${counts.failed > 0 ? 'failed' : 'review'}
    WHERE organization_id = ${organizationId} AND id = ${runId}::uuid AND status = 'computing'
  `);
}

type ComputeOutcome = 'computed' | 'stale' | 'run-not-computing';

async function computeEmployee(
  tx: Tx,
  ctx: RequestContext,
  payload: ComputeEmployeePayload,
): Promise<ComputeOutcome> {
  const run = await tx.maybeOne<{ periodStart: string; periodEnd: string; status: string }>(sql`
    SELECT period_start::text AS "periodStart", period_end::text AS "periodEnd", status
    FROM payroll_run
    WHERE organization_id = ${ctx.organizationId} AND id = ${payload.runId}::uuid
  `);
  // Cancelled, or already settled: nothing to do.
  if (!run || run.status !== 'computing') return 'run-not-computing';

  await lockPerson(tx, payload.userId);
  const employee = await tx.maybeOne<{
    id: string;
    inputs: FrozenEmployeeInputs;
    inputsFingerprint: string;
    status: string;
  }>(sql`
    SELECT id, inputs, inputs_fingerprint AS "inputsFingerprint", status
    FROM payroll_run_employee
    WHERE organization_id = ${ctx.organizationId}
      AND run_id = ${payload.runId}::uuid
      AND user_id = ${payload.userId}::uuid
    FOR UPDATE
  `);
  // A recalculation replaced this input set, or a duplicate delivery found it done.
  if (!employee || employee.inputsFingerprint !== payload.inputsFingerprint) return 'stale';
  if (employee.status === 'computed') return 'stale';

  await computeAndWriteDraftSlip(
    tx,
    ctx.organizationId,
    payload.runId,
    payload.userId,
    run.periodStart,
    run.periodEnd,
    employee.inputs,
    employee.inputsFingerprint,
  );
  await tx.query(sql`
    UPDATE payroll_run_employee SET status = 'computed', computed_at = now()
    WHERE id = ${employee.id}::uuid
  `);
  await settleRunIfDone(tx, ctx.organizationId, payload.runId);
  return 'computed';
}

/** After the last attempt: the employee is failed, and the run with them once nobody is pending. */
async function markEmployeeFailed(tx: Tx, organizationId: string, payload: ComputeEmployeePayload): Promise<void> {
  await tx.query(sql`
    UPDATE payroll_run_employee SET status = 'failed'
    WHERE organization_id = ${organizationId}
      AND run_id = ${payload.runId}::uuid
      AND user_id = ${payload.userId}::uuid
      AND inputs_fingerprint = ${payload.inputsFingerprint}
      AND status IN ('pending', 'computing')
  `);
  await settleRunIfDone(tx, organizationId, payload.runId);
}

export function registerPayrollJobs(): PayrollJobs {
  const computeJob = defineJob<ComputeEmployeePayload>({
    name: 'payroll.compute-employee',
    perOrganization: true,
    module: 'payroll',
    attempts: COMPUTE_ATTEMPTS,
    handler: async ({ ctx, payload, attempt }) => {
      try {
        const outcome = await db.transaction(ctx, (tx) => computeEmployee(tx, ctx, payload));
        return { itemsProcessed: outcome === 'computed' ? 1 : 0, details: { outcome } };
      } catch (error) {
        // A terminal failure must be visible on the run rather than leave it computing.
        if (attempt >= COMPUTE_ATTEMPTS) {
          await db.transaction(ctx, (tx) => markEmployeeFailed(tx, ctx.organizationId, payload));
        }
        throw error;
      }
    },
  });

  // Idempotent: each job is keyed by run, person and input fingerprint, so a
  // second delivery queues nothing new. Retried until delivered: until these
  // jobs are queued, the run would stay computing for ever.
  onOutboxEvent(
    PAYROLL_EVENTS.RUN_STARTED,
    async (event) => {
      const { runId } = event.payload as RunStarted;
      const ctx = createJobContext({
        organizationId: event.organizationId,
        principal: systemPrincipal(event.organizationId),
        jobName: computeJob.name,
        runId: event.id,
      });
      const pending = await db.query<{ userId: string; inputsFingerprint: string }>(ctx, sql`
        SELECT user_id AS "userId", inputs_fingerprint AS "inputsFingerprint"
        FROM payroll_run_employee
        WHERE organization_id = ${event.organizationId}
          AND run_id = ${runId}::uuid
          AND status = 'pending'
      `);
      for (const employee of pending) {
        const payload = { runId, userId: employee.userId, inputsFingerprint: employee.inputsFingerprint };
        await computeJob.enqueue({
          organizationId: event.organizationId,
          key: computeKey(payload),
          payload,
        });
      }
    },
    { retryUntilDelivered: true },
  );

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
