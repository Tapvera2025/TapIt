import type { Tx } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import type { BreakDeductionInput } from '../break-management/facade.js';

/**
 * Payroll input repository — writes and revokes break deductions.
 * Called by BreakDeductionWriter (registered via facade.ts).
 *
 * `amount` is a branded Decimal string — passes directly to SQL as numeric.
 */

export async function writeBreakDeduction(
  tx: Tx,
  input: BreakDeductionInput,
): Promise<{ payrollInputId: string }> {
  const row = await tx.one<{ id: string }>(sql`
    INSERT INTO payroll_input
      (organization_id, user_id, period_start, kind, amount, label, break_breach_id, created_by)
    VALUES (
      current_organization_id(), ${input.userId}, ${input.periodStart}::date,
      'break-deduction', ${input.amount}::numeric,
      ${input.label}, ${input.breakBreachId}::uuid, ${input.userId}
    )
    RETURNING id
  `);
  return { payrollInputId: row.id };
}

export async function revokeBreakDeduction(tx: Tx, breakBreachId: string): Promise<void> {
  await tx.query(sql`
    UPDATE payroll_input
    SET revoked_at = now()
    WHERE break_breach_id = ${breakBreachId}::uuid
      AND revoked_at IS NULL
  `);
}
