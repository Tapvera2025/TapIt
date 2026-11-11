import type { RequestContext } from '../../platform/dal/context.js';
import type { Tx } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import * as PayrollFacade from '../payroll/facade.js';
import { AdvanceError } from './errors.js';

/**
 * How advances reach the payslip (migration 0142). Every live deduction owns
 * one payroll input for its month; publishing the payslip marks it completed.
 *
 *   approval      → the whole approved amount, recovered from the salary of the
 *                   month the advance was given for (or the first month after
 *                   it whose payroll is still open)
 *   HR schedule   → replaces that default plan while it is unpaid, one input
 *                   per scheduled month
 */

const monthLabel = (period: string): string =>
  new Date(`${period}T00:00:00Z`).toLocaleString('en-IN', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });

interface DeductionCharge {
  readonly id: string;
  readonly employeeId: string;
  readonly payrollPeriod: string;
  readonly amountPaise: string;
  readonly requestedForPeriod: string;
}

async function charge(tx: Tx, deduction: DeductionCharge, createdBy: string): Promise<void> {
  await PayrollFacade.writeSourcedInput(tx, {
    kind: 'advance-recovery',
    advanceDeductionId: deduction.id,
    userId: deduction.employeeId,
    periodStart: deduction.payrollPeriod,
    amountPaise: deduction.amountPaise,
    label: 'Salary advance recovery',
    reason: `Advance of ${monthLabel(deduction.requestedForPeriod)}`,
    createdBy,
  });
}

/** On approval: recover the whole advance from its month's salary. */
export async function planDefaultRecovery(
  tx: Tx,
  ctx: RequestContext,
  advance: {
    readonly id: string;
    readonly employeeId: string;
    readonly approvedAmountPaise: string;
    readonly requestedForPeriod: string;
  },
): Promise<void> {
  const period = await PayrollFacade.firstUnpublishedPeriod(
    tx,
    ctx.organizationId,
    advance.requestedForPeriod,
  );
  const row = await tx.one<{ id: string }>(sql`
    INSERT INTO employee_advance_deduction
      (organization_id, advance_id, employee_id, payroll_period, scheduled_amount_paise, planned_by)
    VALUES (${ctx.organizationId}, ${advance.id}, ${advance.employeeId}, ${period}::date,
            ${advance.approvedAmountPaise}, 'approval')
    RETURNING id
  `);
  await charge(
    tx,
    {
      id: row.id,
      employeeId: advance.employeeId,
      payrollPeriod: period,
      amountPaise: advance.approvedAmountPaise,
      requestedForPeriod: advance.requestedForPeriod,
    },
    ctx.principal.id,
  );
}

/**
 * HR schedules part of an advance for a month. The approval's default plan,
 * while still unpaid, gives way: the default row for this month becomes HR's,
 * any other default is cancelled. Returns the deduction's id.
 */
export async function scheduleRecovery(
  tx: Tx,
  ctx: RequestContext,
  advance: {
    readonly id: string;
    readonly employeeId: string;
    readonly approvedAmountPaise: string;
    readonly requestedForPeriod: string;
  },
  payrollPeriod: string,
  amountPaise: string,
): Promise<string> {
  const cancelled = await tx.query<{ id: string }>(sql`
    UPDATE employee_advance_deduction
    SET status = 'cancelled', updated_at = now()
    WHERE organization_id = ${ctx.organizationId} AND advance_id = ${advance.id}
      AND planned_by = 'approval' AND status = 'pending' AND deducted_amount_paise = 0
      AND payroll_period <> ${payrollPeriod}::date
    RETURNING id
  `);
  for (const row of cancelled)
    await PayrollFacade.revokeSourcedInput(
      tx,
      { advanceDeductionId: row.id },
      ctx.principal.id,
      'Replaced by the HR recovery schedule',
    );

  const sameMonth = await tx.maybeOne<{ id: string; plannedBy: string; status: string }>(sql`
    SELECT id, planned_by, status FROM employee_advance_deduction
    WHERE organization_id = ${ctx.organizationId} AND advance_id = ${advance.id}
      AND payroll_period = ${payrollPeriod}::date
    FOR UPDATE
  `);
  if (sameMonth !== null && !(sameMonth.plannedBy === 'approval' && sameMonth.status === 'pending'))
    throw new AdvanceError(
      sameMonth.status === 'cancelled'
        ? 'A recovery for this month was cancelled earlier. Choose another month.'
        : 'A recovery is already scheduled for this month.',
    );

  const used = await tx.one<{ amount: string }>(sql`
    SELECT COALESCE(SUM(scheduled_amount_paise), 0)::text AS amount
    FROM employee_advance_deduction
    WHERE organization_id = ${ctx.organizationId} AND advance_id = ${advance.id}
      AND status <> 'cancelled' AND id IS DISTINCT FROM ${sameMonth?.id ?? null}::uuid
  `);
  if (BigInt(used.amount) + BigInt(amountPaise) > BigInt(advance.approvedAmountPaise))
    throw new AdvanceError('Scheduled deductions cannot exceed the approved balance.');

  const id =
    sameMonth !== null
      ? (
          await tx.one<{ id: string }>(sql`
            UPDATE employee_advance_deduction
            SET scheduled_amount_paise = ${amountPaise}, planned_by = 'hr', updated_at = now()
            WHERE id = ${sameMonth.id}
            RETURNING id
          `)
        ).id
      : (
          await tx.one<{ id: string }>(sql`
            INSERT INTO employee_advance_deduction
              (organization_id, advance_id, employee_id, payroll_period, scheduled_amount_paise)
            VALUES (${ctx.organizationId}, ${advance.id}, ${advance.employeeId}, ${payrollPeriod}::date,
                    ${amountPaise})
            RETURNING id
          `)
        ).id;
  await charge(
    tx,
    {
      id,
      employeeId: advance.employeeId,
      payrollPeriod,
      amountPaise,
      requestedForPeriod: advance.requestedForPeriod,
    },
    ctx.principal.id,
  );
  return id;
}

/** Payroll published a payslip that took these recoveries. */
async function settleDeductions(tx: Tx, ids: readonly string[]): Promise<void> {
  await tx.query(sql`
    UPDATE employee_advance_deduction
    SET deducted_amount_paise = scheduled_amount_paise, status = 'completed',
        deducted_at = now(), updated_at = now()
    WHERE id = ANY(${ids}::uuid[]) AND status IN ('pending', 'partial')
  `);
}

export function registerAdvancePayrollPorts(): void {
  PayrollFacade.registerPayrollSourceSettlers({ advanceDeductions: settleDeductions });
}
