import type { DateOnly } from '@tapcrm/contracts';
import type { RequestContext } from '../../platform/dal/context.js';
import { db, type Tx } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import * as AttFacade from '../attendance/facade.js';
import { writePayrollAudit } from './audit.js';
import { resolveConfig } from './config.js';
import {
  PAYROLL_ERROR_CODES,
  PayrollConflictError,
  PayrollNotFoundError,
  PayrollValidationError,
  monthLabel,
} from './errors.js';
import { PAYROLL_EVENTS, type RunStarted } from './events.js';
import {
  breakEvaluationRequired,
  employeesInPeriod,
  fingerprint,
  freezeEmployees,
  runWarnings,
  type RunWarning,
} from './freeze.js';

export { fingerprint } from './freeze.js';

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
  const [y, m] = periodStart.split('-').map(Number) as [number, number];
  // Last day of month: day 0 of the next month
  const day0 = new Date(y, m, 0);
  const dd = String(day0.getDate()).padStart(2, '0');
  const mm = String(m).padStart(2, '0');
  return `${y}-${mm}-${dd}`;
}

export interface CreateRunInput {
  readonly periodStart: string;  // first of month
}

export interface RunBlocker {
  readonly userId: string | null;
  readonly workDate: string | null;
  readonly kind: string;
  readonly sourceId: string | null;
}

export interface CreateRunResult {
  readonly runId: string;
  readonly employeeCount: number;
  /** Open attendance items: the run can be computed, but not published until they are resolved. */
  readonly blockers: RunBlocker[];
  readonly warnings: RunWarning[];
}

const RUN_COLUMNS = sql`
  id, organization_id AS "organizationId", period_start::text AS "periodStart",
  period_end::text AS "periodEnd", config_id AS "configId", status,
  population_fingerprint AS "populationFingerprint",
  config_fingerprint AS "configFingerprint",
  inputs_changed AS "inputsChanged", created_by AS "createdBy",
  created_at::text AS "createdAt", published_at::text AS "publishedAt"
`;

const VERB: Record<string, string> = {
  start: 'started',
  cancel: 'cancelled',
  recalculate: 'recalculated',
  publish: 'published',
};

function wrongStatus(run: PayrollRunRow, action: string, allowed: readonly RunStatus[]): PayrollConflictError {
  return new PayrollConflictError(
    PAYROLL_ERROR_CODES.WRONG_STATUS,
    `The ${monthLabel(run.periodStart)} run is ${run.status}, so it can't be ${VERB[action] ?? action}. ` +
      `Only a run that is ${allowed.join(' or ')} can be.`,
    { status: run.status, allowed },
  );
}

/**
 * POST run: creates a payroll run in a single REPEATABLE READ freeze transaction.
 * 1. Refuse a second live run for the month, and a month without accepted settings.
 * 2. Find included employees (those with employment overlapping the period).
 * 3. Report open attendance items — named blockers, not a failure.
 * 4. Freeze each employee's complete input set.
 * 5. Write payroll_run and payroll_run_employee rows.
 */
export async function createRun(
  ctx: RequestContext,
  input: CreateRunInput,
): Promise<CreateRunResult> {
  const periodEnd = periodEndFor(input.periodStart);
  const month = monthLabel(input.periodStart);

  return db.transaction(ctx, async (tx) => {
    const existing = await tx.maybeOne<{ id: string; status: RunStatus }>(sql`
      SELECT id, status FROM payroll_run
      WHERE organization_id = ${ctx.organizationId}
        AND period_start = ${input.periodStart}::date
        AND status NOT IN ('failed', 'cancelled')
      LIMIT 1
    `);
    if (existing) {
      throw new PayrollConflictError(
        PAYROLL_ERROR_CODES.RUN_EXISTS,
        existing.status === 'published'
          ? `Payroll for ${month} is already published. To correct someone's pay, revise their payslip.`
          : `A payroll run for ${month} already exists (${existing.status}). Open it, or cancel it before creating another.`,
        { runId: existing.id, status: existing.status },
      );
    }

    const config = await resolveConfig(tx, ctx.organizationId, input.periodStart);
    if (!config) {
      throw new PayrollValidationError(
        PAYROLL_ERROR_CODES.NO_CONFIG,
        `Payroll settings haven't been accepted for ${month} yet. Accept them under Payroll → Settings, then create the run.`,
      );
    }

    const employees = await employeesInPeriod(tx, ctx.organizationId, input.periodStart, periodEnd);
    if (employees.length === 0) {
      throw new PayrollValidationError(
        PAYROLL_ERROR_CODES.NO_EMPLOYEES,
        `Nobody was employed in ${month}. Check the employees' joining and leaving dates.`,
      );
    }
    const userIds = employees.map((e) => e.userId);

    const breakEvaluation = await breakEvaluationRequired(tx, ctx.organizationId);
    const open = await AttFacade.openItems(
      tx,
      userIds,
      input.periodStart as DateOnly,
      periodEnd as DateOnly,
      { breakEvaluation },
    );
    const blockers: RunBlocker[] = open.map((o) => ({
      userId: o.userId,
      workDate: o.workDate ?? null,
      kind: o.kind,
      sourceId: o.sourceId,
    }));

    const frozen = await freezeEmployees(
      tx,
      ctx.organizationId,
      { start: input.periodStart, end: periodEnd },
      config,
      employees,
    );

    const runRow = await tx.one<{ id: string }>(sql`
      INSERT INTO payroll_run
        (organization_id, period_start, period_end, config_id, created_by,
         config_fingerprint, population_fingerprint)
      VALUES (
        ${ctx.organizationId}, ${input.periodStart}::date, ${periodEnd}::date,
        ${config.id}::uuid, ${ctx.principal.id}::uuid,
        ${fingerprint({ configId: config.id, settings: config.settings })},
        ${fingerprint(userIds.slice().sort())}
      )
      RETURNING id
    `);

    for (const emp of frozen) {
      await tx.query(sql`
        INSERT INTO payroll_run_employee
          (organization_id, run_id, user_id, employment_window_start, employment_window_end, inputs, inputs_fingerprint)
        VALUES (
          ${ctx.organizationId}, ${runRow.id}::uuid, ${emp.userId}::uuid,
          ${emp.employmentFrom}::date, ${emp.employmentTo}::date,
          ${JSON.stringify(emp.inputs)}::jsonb, ${emp.fingerprint}
        )
      `);
    }

    await writePayrollAudit(tx, ctx, {
      action: 'payroll.run-created',
      targetType: 'payrollRun',
      targetId: runRow.id,
      after: { periodStart: input.periodStart, employees: frozen.length, blockers: blockers.length },
    });

    return {
      runId: runRow.id,
      employeeCount: frozen.length,
      blockers,
      warnings: runWarnings(employees, frozen),
    };
  }, { isolation: 'repeatable read' });
}

/** Lock a run for a state change, or refuse with 404. */
export async function lockRun(tx: Tx, organizationId: string, runId: string): Promise<PayrollRunRow> {
  const run = await tx.maybeOne<PayrollRunRow>(sql`
    SELECT ${RUN_COLUMNS}
    FROM payroll_run
    WHERE organization_id = ${organizationId} AND id = ${runId}::uuid
    FOR UPDATE
  `);
  if (!run) throw new PayrollNotFoundError('Payroll run not found');
  return run;
}

/** Write the run's queue request; the handler queues its pending employees after commit (TX-2). */
async function requestComputation(tx: Tx, organizationId: string, runId: string): Promise<void> {
  const payload: RunStarted = { runId };
  await tx.query(sql`
    INSERT INTO domain_outbox (organization_id, event_name, payload)
    VALUES (${organizationId}, ${PAYROLL_EVENTS.RUN_STARTED}, ${JSON.stringify(payload)}::jsonb)
  `);
}

/** draft → computing, and queue every employee's calculation. */
export async function startRun(
  ctx: RequestContext,
  runId: string,
): Promise<{ status: RunStatus; queued: number }> {
  return db.transaction(ctx, async (tx) => {
    const run = await lockRun(tx, ctx.organizationId, runId);
    if (run.status !== 'draft') throw wrongStatus(run, 'start', ['draft']);
    const pending = await tx.one<{ count: number }>(sql`
      SELECT count(*)::int AS count
      FROM payroll_run_employee
      WHERE organization_id = ${ctx.organizationId} AND run_id = ${runId}::uuid AND status = 'pending'
    `);
    await transitionRun(tx, runId, ctx.organizationId, 'draft', 'computing');
    await requestComputation(tx, ctx.organizationId, runId);
    await writePayrollAudit(tx, ctx, {
      action: 'payroll.run-started',
      targetType: 'payrollRun',
      targetId: runId,
      after: { periodStart: run.periodStart, employees: pending.count },
    });
    return { status: 'computing', queued: pending.count };
  });
}

const CANCELLABLE: readonly RunStatus[] = ['draft', 'computing', 'review'];

/**
 * Cancel a run that has not been published. Its draft slips are kept for the
 * record, marked cancelled; a new run for the month can then be created.
 */
export async function cancelRun(ctx: RequestContext, runId: string): Promise<{ status: RunStatus }> {
  return db.transaction(ctx, async (tx) => {
    const run = await lockRun(tx, ctx.organizationId, runId);
    if (!CANCELLABLE.includes(run.status)) throw wrongStatus(run, 'cancel', CANCELLABLE);
    await transitionRun(tx, runId, ctx.organizationId, run.status, 'cancelled');
    await tx.query(sql`
      UPDATE payslip SET status = 'cancelled'
      WHERE organization_id = ${ctx.organizationId} AND run_id = ${runId}::uuid AND status = 'draft'
    `);
    await writePayrollAudit(tx, ctx, {
      action: 'payroll.run-cancelled',
      targetType: 'payrollRun',
      targetId: runId,
      before: { status: run.status },
      after: { status: 'cancelled', periodStart: run.periodStart },
    });
    return { status: 'cancelled' };
  });
}

/**
 * Re-freeze a run in review after its inputs changed — a correction, leave,
 * a bonus, a salary change — and recalculate the employees whose inputs
 * differ (design §9, Task 4: regeneration in review). A changed population or
 * changed settings need a new run instead.
 */
export async function recalculateRun(
  ctx: RequestContext,
  runId: string,
): Promise<{ status: RunStatus; recalculated: number }> {
  return db.transaction(ctx, async (tx) => {
    const run = await lockRun(tx, ctx.organizationId, runId);
    if (run.status !== 'review') throw wrongStatus(run, 'recalculate', ['review']);
    const month = monthLabel(run.periodStart);

    const config = await resolveConfig(tx, ctx.organizationId, run.periodStart);
    if (!config || config.id !== run.configId) {
      throw new PayrollConflictError(
        PAYROLL_ERROR_CODES.CONFIG_CHANGED,
        `Payroll settings for ${month} changed after this run was created. Cancel this run and create a new one.`,
      );
    }

    const rows = await tx.query<{ id: string; userId: string; inputsFingerprint: string; status: string }>(sql`
      SELECT id, user_id AS "userId", inputs_fingerprint AS "inputsFingerprint", status
      FROM payroll_run_employee
      WHERE organization_id = ${ctx.organizationId} AND run_id = ${runId}::uuid
    `);
    const employees = await employeesInPeriod(tx, ctx.organizationId, run.periodStart, run.periodEnd);
    const change = populationChange(rows.map((r) => r.userId), employees.map((e) => e.userId));
    if (change.joined.length > 0 || change.left.length > 0) {
      throw new PayrollConflictError(
        PAYROLL_ERROR_CODES.POPULATION_CHANGED,
        `Employees joined or left ${month} after this run was created. Cancel this run and create a new one.`,
        change,
      );
    }

    const frozen = await freezeEmployees(
      tx,
      ctx.organizationId,
      { start: run.periodStart, end: run.periodEnd },
      config,
      employees,
    );
    const byUser = new Map(rows.map((r) => [r.userId, r]));
    let recalculated = 0;
    for (const emp of frozen) {
      const row = byUser.get(emp.userId)!;
      if (row.inputsFingerprint === emp.fingerprint && row.status === 'computed') continue;
      await tx.query(sql`
        UPDATE payroll_run_employee
        SET inputs = ${JSON.stringify(emp.inputs)}::jsonb,
            inputs_fingerprint = ${emp.fingerprint},
            employment_window_start = ${emp.employmentFrom}::date,
            employment_window_end = ${emp.employmentTo}::date,
            status = 'pending',
            computed_at = NULL
        WHERE id = ${row.id}::uuid
      `);
      recalculated += 1;
    }
    await tx.query(sql`
      UPDATE payroll_run SET inputs_changed = false
      WHERE organization_id = ${ctx.organizationId} AND id = ${runId}::uuid
    `);
    if (recalculated === 0) return { status: 'review', recalculated: 0 };

    await transitionRun(tx, runId, ctx.organizationId, 'review', 'computing');
    await requestComputation(tx, ctx.organizationId, runId);
    await writePayrollAudit(tx, ctx, {
      action: 'payroll.run-recalculated',
      targetType: 'payrollRun',
      targetId: runId,
      after: { periodStart: run.periodStart, employees: recalculated },
    });
    return { status: 'computing', recalculated };
  }, { isolation: 'repeatable read' });
}

export function populationChange(
  frozen: readonly string[],
  live: readonly string[],
): { joined: string[]; left: string[] } {
  const frozenSet = new Set(frozen);
  const liveSet = new Set(live);
  return {
    joined: live.filter((id) => !frozenSet.has(id)),
    left: frozen.filter((id) => !liveSet.has(id)),
  };
}

/** Transition a run's status. Refuses (409) if the run is no longer in `from`. */
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
  if (updated.length === 0) {
    throw new PayrollConflictError(
      PAYROLL_ERROR_CODES.WRONG_STATUS,
      `This payroll run is no longer ${from}. Refresh and try again.`,
      { expected: from },
    );
  }
}

/** The run, locked for the caller's transaction (publication). */
export async function getRunById(
  tx: Tx,
  runId: string,
): Promise<PayrollRunRow | null> {
  return tx.maybeOne<PayrollRunRow>(sql`
    SELECT ${RUN_COLUMNS}
    FROM payroll_run WHERE id = ${runId}::uuid
    FOR UPDATE
  `);
}

export interface RunSummaryRow extends PayrollRunRow {
  readonly employeeCount: number;
  readonly computedCount: number;
  readonly failedCount: number;
  readonly pendingCount: number;
}

const RUN_SUMMARY = sql`
  SELECT r.id, r.organization_id AS "organizationId", r.period_start::text AS "periodStart",
         r.period_end::text AS "periodEnd", r.config_id AS "configId", r.status,
         r.population_fingerprint AS "populationFingerprint",
         r.config_fingerprint AS "configFingerprint",
         r.inputs_changed AS "inputsChanged", r.created_by AS "createdBy",
         r.created_at::text AS "createdAt", r.published_at::text AS "publishedAt",
         (SELECT count(*)::int FROM payroll_run_employee e
           WHERE e.organization_id = r.organization_id AND e.run_id = r.id) AS "employeeCount",
         (SELECT count(*)::int FROM payroll_run_employee e
           WHERE e.organization_id = r.organization_id AND e.run_id = r.id AND e.status = 'computed') AS "computedCount",
         (SELECT count(*)::int FROM payroll_run_employee e
           WHERE e.organization_id = r.organization_id AND e.run_id = r.id AND e.status = 'failed') AS "failedCount",
         (SELECT count(*)::int FROM payroll_run_employee e
           WHERE e.organization_id = r.organization_id AND e.run_id = r.id AND e.status IN ('pending', 'computing')) AS "pendingCount"
  FROM payroll_run r
`;

export async function listRuns(tx: Tx, organizationId: string): Promise<RunSummaryRow[]> {
  return tx.query<RunSummaryRow>(sql`
    ${RUN_SUMMARY}
    WHERE r.organization_id = ${organizationId}
    ORDER BY r.period_start DESC, r.created_at DESC
  `);
}

export async function readRun(tx: Tx, organizationId: string, runId: string): Promise<RunSummaryRow | null> {
  return tx.maybeOne<RunSummaryRow>(sql`
    ${RUN_SUMMARY}
    WHERE r.organization_id = ${organizationId} AND r.id = ${runId}::uuid
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

export interface ReviewLine {
  readonly code: string;
  readonly label: string;
  readonly kind: 'earning' | 'deduction' | 'employer-contribution';
  readonly amountPaise: string;
  readonly sortOrder: number;
}

export interface ReviewEmployee {
  readonly userId: string;
  readonly fullName: string;
  readonly employeeCode: string | null;
  readonly departmentName: string | null;
  readonly status: RunEmployeeRow['status'];
  readonly computedAt: string | null;
  readonly employmentWindowStart: string;
  readonly employmentWindowEnd: string | null;
  readonly hasSalaryStructure: boolean;
  readonly payslipId: string | null;
  readonly payslipStatus: string | null;
  readonly grossPaise: string | null;
  readonly deductionsPaise: string | null;
  readonly netPaise: string | null;
  /** Paid and total days of the month, from the calculation's basis. */
  readonly paidDayCount: number | null;
  readonly periodDayCount: number | null;
  readonly lines: ReviewLine[];
}

/**
 * The review list (design §9, Task 4): each employee with the draft or
 * published slip this run produced, its lines and paid days. The frozen input
 * JSON itself stays on the server.
 */
export async function listRunEmployeesForReview(
  tx: Tx,
  organizationId: string,
  runId: string,
): Promise<ReviewEmployee[]> {
  const rows = await tx.query<Omit<ReviewEmployee, 'lines' | 'paidDayCount' | 'periodDayCount'>>(sql`
    SELECT e.user_id AS "userId", u.full_name AS "fullName", u.employee_id AS "employeeCode",
           d.name AS "departmentName", e.status, e.computed_at::text AS "computedAt",
           e.employment_window_start::text AS "employmentWindowStart",
           e.employment_window_end::text AS "employmentWindowEnd",
           jsonb_array_length(COALESCE(e.inputs -> 'structureSegments', '[]'::jsonb)) > 0 AS "hasSalaryStructure",
           p.id AS "payslipId", p.status AS "payslipStatus",
           p.gross_paise::text AS "grossPaise", p.deductions_paise::text AS "deductionsPaise",
           p.net_paise::text AS "netPaise"
    FROM payroll_run_employee e
    JOIN app_user u ON u.organization_id = e.organization_id AND u.id = e.user_id
    LEFT JOIN department d ON d.organization_id = u.organization_id AND d.id = u.department_id
    LEFT JOIN LATERAL (
      SELECT s.id, s.status, s.gross_paise, s.deductions_paise, s.net_paise
      FROM payslip s
      WHERE s.organization_id = e.organization_id AND s.run_id = e.run_id AND s.user_id = e.user_id
        AND s.status IN ('draft', 'published')
      ORDER BY (s.status = 'published') DESC, s.revision_number DESC
      LIMIT 1
    ) p ON true
    WHERE e.organization_id = ${organizationId} AND e.run_id = ${runId}::uuid
    ORDER BY u.full_name, e.user_id
  `);
  const slipIds = rows.flatMap((r) => (r.payslipId === null ? [] : [r.payslipId]));
  const lines = slipIds.length === 0
    ? []
    : await tx.query<ReviewLine & { payslipId: string; basis: Record<string, unknown> | null }>(sql`
        SELECT payslip_id AS "payslipId", code, label, kind, amount_paise::text AS "amountPaise",
               sort_order AS "sortOrder", basis
        FROM payslip_line
        WHERE organization_id = ${organizationId} AND payslip_id = ANY(${slipIds}::uuid[])
        ORDER BY payslip_id, sort_order
      `);
  const linesBySlip = new Map<string, typeof lines>();
  for (const line of lines) {
    const list = linesBySlip.get(line.payslipId) ?? [];
    list.push(line);
    linesBySlip.set(line.payslipId, list);
  }
  return rows.map((row) => {
    const slipLines = row.payslipId === null ? [] : (linesBySlip.get(row.payslipId) ?? []);
    const prorated = slipLines.find((l) => l.basis?.['prorated'] === true)?.basis ?? null;
    const paidUnits = typeof prorated?.['paidUnits'] === 'number' ? prorated['paidUnits'] : null;
    const totalUnits = typeof prorated?.['totalUnits'] === 'number' ? prorated['totalUnits'] : null;
    return {
      ...row,
      paidDayCount: paidUnits === null ? null : paidUnits / 2,
      periodDayCount: totalUnits === null ? null : totalUnits / 2,
      lines: slipLines.map(({ code, label, kind, amountPaise, sortOrder }) => ({
        code, label, kind, amountPaise, sortOrder,
      })),
    };
  });
}
