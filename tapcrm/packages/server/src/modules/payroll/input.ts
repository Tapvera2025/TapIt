import type { Tx } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import type { BreakDeductionInput } from '../break-management/facade.js';

export type ManualInputKind = 'adjustment' | 'advance-recovery' | 'arrear' | 'bonus' | 'tds';

export interface ManualInputInsert {
  readonly userId: string;
  readonly periodStart: string;
  readonly kind: ManualInputKind;
  readonly amount: number;
  readonly label: string;
  readonly reason: string;
  readonly createdBy: string;
}

export interface PayrollInputRow {
  readonly id: string;
  readonly userId: string;
  readonly periodStart: string;
  readonly kind: string;
  readonly amount: string;
  readonly label: string;
  readonly reason: string | null;
  readonly breakBreachId: string | null;
  readonly createdAt: string;
  readonly createdBy: string;
  readonly revokedAt: string | null;
  readonly revokedBy: string | null;
  readonly revocationReason: string | null;
}

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

export async function insertManualInput(
  tx: Tx,
  organizationId: string,
  input: ManualInputInsert,
): Promise<{ id: string }> {
  const row = await tx.one<{ id: string }>(sql`
    INSERT INTO payroll_input
      (organization_id, user_id, period_start, kind, amount, label, reason, created_by)
    VALUES (
      ${organizationId}, ${input.userId}::uuid, ${input.periodStart}::date,
      ${input.kind}, ${input.amount}, ${input.label}, ${input.reason}, ${input.createdBy}::uuid
    )
    RETURNING id
  `);
  return { id: row.id };
}

export async function revokeManualInput(
  tx: Tx,
  organizationId: string,
  inputId: string,
  revokedBy: string,
  reason: string,
): Promise<void> {
  await tx.query(sql`
    UPDATE payroll_input
    SET revoked_at = now(), revoked_by = ${revokedBy}::uuid, revocation_reason = ${reason}
    WHERE organization_id = ${organizationId}
      AND id = ${inputId}::uuid
      AND break_breach_id IS NULL
      AND revoked_at IS NULL
  `);
}

export async function listActiveInputsForPeriod(
  tx: Tx,
  organizationId: string,
  userIds: readonly string[],
  periodStart: string,
): Promise<PayrollInputRow[]> {
  if (userIds.length === 0) return [];
  return tx.query<PayrollInputRow>(sql`
    SELECT id, user_id AS "userId", period_start::text AS "periodStart",
           kind, amount::text AS amount, label, reason,
           break_breach_id AS "breakBreachId",
           created_at::text AS "createdAt", created_by AS "createdBy",
           revoked_at::text AS "revokedAt", revoked_by AS "revokedBy",
           revocation_reason AS "revocationReason"
    FROM payroll_input
    WHERE organization_id = ${organizationId}
      AND user_id = ANY(${userIds}::uuid[])
      AND period_start = ${periodStart}::date
      AND revoked_at IS NULL
    ORDER BY created_at
  `);
}
