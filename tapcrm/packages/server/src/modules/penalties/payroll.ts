import type { Tx } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import * as PayrollFacade from '../payroll/facade.js';

/**
 * How a penalty reaches the payslip (migration 0142): an active penalty owns
 * one payroll deduction in its payroll month; cancelling it withdraws the
 * deduction; publishing the payslip that took it marks it recovered. A
 * penalty cancelled after its payslip was published shows up as a change to
 * that payslip, which HR revises to refund it.
 */

const typeLabel = (penaltyType: string): string => penaltyType.replace(/_/g, ' ');

export async function chargePenalty(
  tx: Tx,
  penalty: {
    readonly id: string;
    readonly employeeId: string;
    readonly payrollPeriod: string;
    readonly amountPaise: string;
    readonly penaltyType: string;
    readonly remarks: string;
  },
  createdBy: string,
): Promise<void> {
  await PayrollFacade.writeSourcedInput(tx, {
    kind: 'penalty',
    penaltyId: penalty.id,
    userId: penalty.employeeId,
    periodStart: penalty.payrollPeriod,
    amountPaise: penalty.amountPaise,
    label: `Penalty: ${typeLabel(penalty.penaltyType)}`,
    reason: penalty.remarks,
    createdBy,
  });
}

export async function releasePenalty(tx: Tx, id: string, by: string, reason: string): Promise<void> {
  await PayrollFacade.revokeSourcedInput(tx, { penaltyId: id }, by, `Penalty cancelled: ${reason}`);
}

async function settlePenalties(tx: Tx, ids: readonly string[]): Promise<void> {
  await tx.query(sql`
    UPDATE employee_penalty
    SET payroll_status = 'recovered', updated_at = now()
    WHERE id = ANY(${ids}::uuid[]) AND status = 'active' AND payroll_status <> 'recovered'
  `);
}

export function registerPenaltyPayrollPorts(): void {
  PayrollFacade.registerPayrollSourceSettlers({ penalties: settlePenalties });
}
