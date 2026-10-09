import type { DateOnly } from '@tapcrm/contracts';
import type { Tx } from '../../platform/dal/db.js';
import { addDays } from '../../platform/time.js';
import { sql } from '../../platform/dal/sql.js';
import {
  computePayslip,
  type ComputePayslipInput,
  type FrozenDay,
  type FrozenStructureSegment,
  type FrozenInput,
} from './calculate.js';
import { type PayrollInputRow } from './input.js';

export interface FrozenEmployeeInputs {
  readonly employmentFrom: string;
  readonly employmentTo: string | null;
  readonly days: FrozenDay[];
  readonly structureSegments: FrozenStructureSegment[];
  readonly payrollInputs: PayrollInputRow[];
  readonly configSnapshot: {
    id: string;
    effectiveFrom: string;
    settings: Record<string, unknown>;
  };
}

function toFrozenInput(row: PayrollInputRow): FrozenInput {
  const kind = row.kind;
  const direction: 'earning' | 'deduction' =
    kind === 'adjustment' || kind === 'arrear' || kind === 'bonus'
      ? 'earning'
      : 'deduction';
  return {
    id: row.id,
    kind,
    amountStr: row.amount,
    label: row.label,
    direction,
    sourceId: row.breakBreachId,
  };
}

/**
 * Compute a draft payslip from frozen employee inputs.
 * Called by the compute worker; reads only payroll_run_employee.inputs.
 */
export async function computeAndWriteDraftSlip(
  tx: Tx,
  organizationId: string,
  runId: string,
  userId: string,
  periodStart: string,
  periodEnd: string,
  frozenInputs: FrozenEmployeeInputs,
  inputsFingerprint: string,
): Promise<{ payslipId: string }> {
  const calcInput: ComputePayslipInput = {
    userId,
    periodStart,
    periodEnd,
    employmentFrom: frozenInputs.employmentFrom,
    employmentTo: frozenInputs.employmentTo,
    days: frozenInputs.days,
    structureSegments: frozenInputs.structureSegments,
    inputs: frozenInputs.payrollInputs.map(toFrozenInput),
    config: { schemaVersion: 'v1', settings: frozenInputs.configSnapshot.settings },
  };
  const result = computePayslip(calcInput);

  // Delete any existing draft slip lines for this person/run (for regeneration)
  const existingSlip = await tx.maybeOne<{ id: string }>(sql`
    SELECT id FROM payslip
    WHERE organization_id = ${organizationId}
      AND run_id = ${runId}::uuid
      AND user_id = ${userId}::uuid
      AND status = 'draft'
  `);

  let slipId: string;
  if (existingSlip) {
    slipId = existingSlip.id;
    await tx.query(
      sql`DELETE FROM payslip_line WHERE organization_id = ${organizationId} AND payslip_id = ${slipId}::uuid`,
    );
    await tx.query(
      sql`DELETE FROM payslip_salary_use WHERE organization_id = ${organizationId} AND payslip_id = ${slipId}::uuid`,
    );
    await tx.query(sql`
      UPDATE payslip SET
        gross_paise = ${result.grossPaise.toString()},
        deductions_paise = ${result.deductionsPaise.toString()},
        net_paise = ${result.netPaise.toString()},
        employer_contribution_paise = ${result.employerContributionPaise.toString()},
        inputs = ${JSON.stringify(frozenInputs)}::jsonb,
        inputs_fingerprint = ${inputsFingerprint}
      WHERE id = ${slipId}::uuid
    `);
  } else {
    const slipRow = await tx.one<{ id: string }>(sql`
      INSERT INTO payslip
        (organization_id, run_id, user_id, period_start, period_end,
         gross_paise, deductions_paise, net_paise, employer_contribution_paise,
         inputs, inputs_fingerprint)
      VALUES (
        ${organizationId}, ${runId}::uuid, ${userId}::uuid,
        ${periodStart}::date, ${periodEnd}::date,
        ${result.grossPaise.toString()}, ${result.deductionsPaise.toString()},
        ${result.netPaise.toString()}, ${result.employerContributionPaise.toString()},
        ${JSON.stringify(frozenInputs)}::jsonb, ${inputsFingerprint}
      )
      RETURNING id
    `);
    slipId = slipRow.id;
  }

  // Write lines
  for (const line of result.lines) {
    await tx.query(sql`
      INSERT INTO payslip_line (organization_id, payslip_id, code, label, kind, amount_paise, basis, sort_order)
      VALUES (${organizationId}, ${slipId}::uuid, ${line.code}, ${line.label}, ${line.kind},
              ${line.amountPaise.toString()}, ${JSON.stringify(line.basis)}::jsonb, ${line.sortOrder})
    `);
  }

  // Write salary use rows. A structure's effective_to is exclusive.
  for (const seg of frozenInputs.structureSegments) {
    const usedFrom = periodStart > seg.effectiveFrom ? periodStart : seg.effectiveFrom;
    const lastDay =
      seg.effectiveTo === null ? null : addDays(seg.effectiveTo as DateOnly, -1);
    const usedTo = lastDay !== null && lastDay < periodEnd ? lastDay : periodEnd;
    if (usedTo < usedFrom) continue;
    await tx.query(sql`
      INSERT INTO payslip_salary_use (organization_id, payslip_id, structure_id, used_from, used_to)
      VALUES (${organizationId}, ${slipId}::uuid, ${seg.structureId}::uuid,
              ${usedFrom}::date, ${usedTo}::date)
    `);
  }

  return { payslipId: slipId };
}
