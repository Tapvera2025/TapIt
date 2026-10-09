import type { Decimal } from '@tapcrm/contracts';
import type { Tx } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import type { BreakDeductionInput } from '../break-management/facade.js';

export type ManualInputKind =
  'adjustment' | 'advance-recovery' | 'arrear' | 'bonus' | 'tds';

export interface ManualInputInsert {
  readonly userId: string;
  readonly periodStart: string;
  readonly kind: ManualInputKind;
  readonly amount: Decimal;
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

/** Revoke a manual input. False when there is no such active manual input. */
export async function revokeManualInput(
  tx: Tx,
  organizationId: string,
  inputId: string,
  revokedBy: string,
  reason: string,
): Promise<boolean> {
  const rows = await tx.query<{ id: string }>(sql`
    UPDATE payroll_input
    SET revoked_at = now(), revoked_by = ${revokedBy}::uuid, revocation_reason = ${reason}
    WHERE organization_id = ${organizationId}
      AND id = ${inputId}::uuid
      AND break_breach_id IS NULL
      AND revoked_at IS NULL
    RETURNING id
  `);
  return rows.length > 0;
}

/**
 * Where an input stands for its month:
 *   pending    — not in any run or payslip yet; the month's next run picks it up
 *   in-run     — frozen into the month's live run
 *   published  — paid in the person's latest published payslip
 *   unpaid     — the month is published without it: revise that payslip to pay it
 *   revoked    — withdrawn
 */
export type PayrollInputState = 'pending' | 'in-run' | 'published' | 'unpaid' | 'revoked';

export interface PayrollInputListRow extends PayrollInputRow {
  readonly fullName: string;
  readonly employeeCode: string | null;
  readonly createdByName: string | null;
  readonly state: PayrollInputState;
}

export async function listInputs(
  tx: Tx,
  organizationId: string,
  filter: { readonly periodStart: string; readonly userId?: string | undefined },
): Promise<PayrollInputListRow[]> {
  return tx.query<PayrollInputListRow>(sql`
    SELECT i.id, i.user_id AS "userId", i.period_start::text AS "periodStart",
           i.kind, i.amount::text AS amount, i.label, i.reason,
           i.break_breach_id AS "breakBreachId",
           i.created_at::text AS "createdAt", i.created_by AS "createdBy",
           i.revoked_at::text AS "revokedAt", i.revoked_by AS "revokedBy",
           i.revocation_reason AS "revocationReason",
           u.full_name AS "fullName", u.employee_id AS "employeeCode",
           cb.full_name AS "createdByName",
           CASE
             WHEN i.revoked_at IS NOT NULL THEN 'revoked'
             WHEN latest.id IS NOT NULL AND latest.inputs -> 'payrollInputs' @> jsonb_build_array(jsonb_build_object('id', i.id::text))
               THEN 'published'
             WHEN latest.id IS NOT NULL THEN 'unpaid'
             WHEN run_employee.inputs -> 'payrollInputs' @> jsonb_build_array(jsonb_build_object('id', i.id::text))
               THEN 'in-run'
             ELSE 'pending'
           END AS state
    FROM payroll_input i
    JOIN app_user u ON u.organization_id = i.organization_id AND u.id = i.user_id
    LEFT JOIN app_user cb ON cb.organization_id = i.organization_id AND cb.id = i.created_by
    LEFT JOIN LATERAL (
      SELECT p.id, p.inputs FROM payslip p
      WHERE p.organization_id = i.organization_id AND p.user_id = i.user_id
        AND p.period_start = i.period_start AND p.status = 'published'
      ORDER BY p.revision_number DESC
      LIMIT 1
    ) latest ON true
    LEFT JOIN LATERAL (
      SELECT e.inputs FROM payroll_run r
      JOIN payroll_run_employee e ON e.organization_id = r.organization_id AND e.run_id = r.id
      WHERE r.organization_id = i.organization_id AND r.period_start = i.period_start
        AND r.status NOT IN ('failed', 'cancelled', 'published') AND e.user_id = i.user_id
      LIMIT 1
    ) run_employee ON true
    WHERE i.organization_id = ${organizationId}
      AND i.period_start = ${filter.periodStart}::date
      AND (${filter.userId ?? null}::uuid IS NULL OR i.user_id = ${filter.userId ?? null}::uuid)
    ORDER BY u.full_name, i.created_at
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
