import { createHash } from 'node:crypto';
import type { DateOnly } from '@tapcrm/contracts';
import type { RequestContext } from '../../platform/dal/context.js';
import { db, type Tx } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import * as AttFacade from '../attendance/facade.js';
import { resolveConfig } from './config.js';
import { resolveStructureForDate } from './structure.js';
import { listActiveInputsForPeriod } from './input.js';

export type RunStatus = 'draft' | 'computing' | 'review' | 'publishing' | 'published' | 'failed' | 'cancelled';

export interface PayrollRunRow {
  readonly id: string;
  readonly organizationId: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly configId: string;
  readonly status: RunStatus;
  readonly populationFingerprint: string | null;
  readonly configFingerprint: string | null;
  readonly inputsChanged: boolean;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly publishedAt: string | null;
}

export interface RunEmployeeRow {
  readonly id: string;
  readonly runId: string;
  readonly userId: string;
  readonly employmentWindowStart: string;
  readonly employmentWindowEnd: string | null;
  readonly inputs: Record<string, unknown>;
  readonly inputsFingerprint: string;
  readonly status: 'pending' | 'computing' | 'computed' | 'failed';
  readonly computedAt: string | null;
}

/** Get the last day of a month for a given YYYY-MM-DD first-of-month. */
export function periodEndFor(periodStart: string): string {
  const d = new Date(periodStart);
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return end.toISOString().slice(0, 10);
}

/** SHA-256 canonical fingerprint over sorted JSON arrays. */
export function fingerprint(data: unknown): string {
  return createHash('sha256').update(JSON.stringify(sortDeep(data))).digest('hex');
}

function sortDeep(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortDeep);
  if (v !== null && typeof v === 'object') {
    const obj = v as Record<string, unknown>;
    return Object.fromEntries(Object.keys(obj).sort().map(k => [k, sortDeep(obj[k])]));
  }
  return v;
}

export interface CreateRunInput {
  readonly periodStart: string;  // first of month
}

export interface CreateRunResult {
  readonly runId: string;
  readonly blockers: RunBlocker[];
}

export interface RunBlocker {
  readonly userId: string;
  readonly workDate: string | null;
  readonly kind: string;
  readonly sourceId: string | null;
}

/**
 * POST run: creates a payroll run in a single REPEATABLE READ freeze transaction.
 * 1. Resolve accepted config for the period.
 * 2. Find included employees (those with employment overlapping the period).
 * 3. Snapshot attendance for all employees.
 * 4. Check for open items — return named blockers instead of failing.
 * 5. Freeze each employee's complete input set.
 * 6. Write payroll_run and payroll_run_employee rows.
 */
export async function createRun(
  ctx: RequestContext,
  input: CreateRunInput,
): Promise<CreateRunResult> {
  const periodEnd = periodEndFor(input.periodStart);

  return db.transaction(ctx, async (tx) => {
    // 1. Resolve config
    const config = await resolveConfig(tx, ctx.organizationId, input.periodStart);
    if (!config) throw new Error('PAYROLL_NO_CONFIG: No accepted active config covers this period');

    // 2. Find employed users in the period
    const employedUsers = await getEmployedUsersInPeriod(tx, ctx.organizationId, input.periodStart, periodEnd);
    if (employedUsers.length === 0) throw new Error('PAYROLL_NO_EMPLOYEES: No employees in period');

    const userIds = employedUsers.map(u => u.userId);

    // 3. Snapshot attendance
    const snapshot = await AttFacade.snapshotPeriod(tx, userIds, input.periodStart as DateOnly, periodEnd as DateOnly);

    // 4. Check open items
    const open = await AttFacade.openItems(tx, userIds, input.periodStart as DateOnly, periodEnd as DateOnly);
    const blockers: RunBlocker[] = open.map(o => ({
      userId: o.userId,
      workDate: o.workDate ?? null,
      kind: o.kind,
      sourceId: o.sourceId,
    }));

    // 5. Insert the run row first
    const runRow = await tx.one<{ id: string }>(sql`
      INSERT INTO payroll_run
        (organization_id, period_start, period_end, config_id, created_by)
      VALUES (${ctx.organizationId}, ${input.periodStart}::date, ${periodEnd}::date, ${config.id}::uuid, ${ctx.principal.id}::uuid)
      RETURNING id
    `);

    const configFp = fingerprint({ configId: config.id, settings: config.settings });

    await tx.query(sql`
      UPDATE payroll_run SET config_fingerprint = ${configFp} WHERE id = ${runRow.id}::uuid
    `);

    const allInputs = await listActiveInputsForPeriod(tx, ctx.organizationId, userIds, input.periodStart);

    // 6. Freeze each employee's inputs
    for (const emp of employedUsers) {
      const empDays = snapshot.days.filter(d => d.userId === emp.userId);
      const empInputs = allInputs.filter(i => i.userId === emp.userId);
      const structure = await resolveStructureForDate(tx, ctx.organizationId, emp.userId, periodEnd);

      const frozenInputs: Record<string, unknown> = {
        employmentFrom: emp.employmentFrom,
        employmentTo: emp.employmentTo,
        days: empDays,
        structureSegments: structure ? [structure] : [],
        payrollInputs: empInputs,
        configSnapshot: { id: config.id, effectiveFrom: config.effectiveFrom, settings: config.settings },
      };
      const fp = fingerprint(frozenInputs);

      await tx.query(sql`
        INSERT INTO payroll_run_employee
          (organization_id, run_id, user_id, employment_window_start, employment_window_end, inputs, inputs_fingerprint)
        VALUES (
          ${ctx.organizationId}, ${runRow.id}::uuid, ${emp.userId}::uuid,
          ${emp.employmentFrom}::date, ${emp.employmentTo ?? null}::date,
          ${JSON.stringify(frozenInputs)}::jsonb, ${fp}
        )
      `);
    }

    const populationFp = fingerprint(userIds.slice().sort());
    await tx.query(sql`
      UPDATE payroll_run SET population_fingerprint = ${populationFp} WHERE id = ${runRow.id}::uuid
    `);

    return { runId: runRow.id, blockers };
  }, { isolation: 'repeatable read' });
}

/** Transition a run's status. Service validates allowed transitions. */
export async function transitionRun(
  tx: Tx,
  runId: string,
  organizationId: string,
  from: RunStatus,
  to: RunStatus,
): Promise<void> {
  const updated = await tx.query<{ id: string }>(sql`
    UPDATE payroll_run SET status = ${to}
    WHERE id = ${runId}::uuid AND organization_id = ${organizationId} AND status = ${from}
    RETURNING id
  `);
  if (updated.length === 0) throw new Error(`Run ${runId} not in status ${from}`);
}

export async function getRunById(
  tx: Tx,
  runId: string,
): Promise<PayrollRunRow | null> {
  return tx.maybeOne<PayrollRunRow>(sql`
    SELECT id, organization_id AS "organizationId", period_start::text AS "periodStart",
           period_end::text AS "periodEnd", config_id AS "configId", status,
           population_fingerprint AS "populationFingerprint",
           config_fingerprint AS "configFingerprint",
           inputs_changed AS "inputsChanged", created_by AS "createdBy",
           created_at::text AS "createdAt", published_at::text AS "publishedAt"
    FROM payroll_run WHERE id = ${runId}::uuid
    FOR UPDATE
  `);
}

export async function getRunEmployees(
  tx: Tx,
  runId: string,
  organizationId: string,
): Promise<RunEmployeeRow[]> {
  return tx.query<RunEmployeeRow>(sql`
    SELECT id, run_id AS "runId", user_id AS "userId",
           employment_window_start::text AS "employmentWindowStart",
           employment_window_end::text AS "employmentWindowEnd",
           inputs, inputs_fingerprint AS "inputsFingerprint",
           status, computed_at::text AS "computedAt"
    FROM payroll_run_employee
    WHERE organization_id = ${organizationId} AND run_id = ${runId}::uuid
    ORDER BY user_id
  `);
}

async function getEmployedUsersInPeriod(
  tx: Tx,
  organizationId: string,
  periodStart: string,
  periodEnd: string,
): Promise<{ userId: string; employmentFrom: string; employmentTo: string | null }[]> {
  return tx.query<{ userId: string; employmentFrom: string; employmentTo: string | null }>(sql`
    SELECT id AS "userId",
           employment_start::text AS "employmentFrom",
           employment_end::text AS "employmentTo"
    FROM app_user
    WHERE organization_id = ${organizationId}
      AND account_type = 'employee'
      AND employment_start IS NOT NULL
      AND employment_start <= ${periodEnd}::date
      AND (employment_end IS NULL OR employment_end >= ${periodStart}::date)
    ORDER BY id
  `);
}
