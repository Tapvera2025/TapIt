import { createHash } from 'node:crypto';
import type { DateOnly } from '@tapcrm/contracts';
import type { Tx } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import * as AttFacade from '../attendance/facade.js';
import type { FrozenDay, FrozenStructureLine, FrozenStructureSegment } from './calculate.js';
import type { PayrollConfigRow } from './config.js';
import { listActiveInputsForPeriod, type PayrollInputRow } from './input.js';
import type { FrozenEmployeeInputs } from './snapshot.js';

/**
 * The freeze (design §9, Task 4): everything a payslip is computed from,
 * read once and stored with the run. Creating a run, recalculating it,
 * checking it at publication and revising a published slip all build the
 * input set here, so the same live data always yields the same fingerprint —
 * which is how publication knows nothing changed since the calculation.
 */

/** SHA-256 canonical fingerprint over sorted JSON. */
export function fingerprint(data: unknown): string {
  return createHash('sha256').update(JSON.stringify(sortDeep(data))).digest('hex');
}

function sortDeep(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortDeep);
  if (v !== null && typeof v === 'object') {
    const obj = v as Record<string, unknown>;
    return Object.fromEntries(Object.keys(obj).sort().map((k) => [k, sortDeep(obj[k])]));
  }
  return v;
}

/** A person employed at some point in the period, with the window the payslip uses. */
export interface PeriodEmployee {
  readonly userId: string;
  readonly fullName: string;
  readonly accountStatus: string;
  readonly joinedOn: string | null;
  readonly leftOn: string | null;
  /** The joining date, or the period start when none is recorded (no lower bound). */
  readonly employmentFrom: string;
  readonly employmentTo: string | null;
}

/**
 * Employees whose employment window overlaps the period. A missing joining
 * date is no lower bound, as in attendance. A deactivated account is included
 * while its window overlaps: without a leaving date its days would otherwise
 * go unpaid silently, so the run reports it instead (`no-leaving-date`).
 */
export async function employeesInPeriod(
  tx: Tx,
  organizationId: string,
  periodStart: string,
  periodEnd: string,
  onlyUserIds?: readonly string[],
): Promise<PeriodEmployee[]> {
  const rows = await tx.query<Omit<PeriodEmployee, 'employmentFrom' | 'employmentTo'>>(sql`
    SELECT id AS "userId", full_name AS "fullName", status AS "accountStatus",
           joined_on::text AS "joinedOn", left_on::text AS "leftOn"
    FROM app_user
    WHERE organization_id = ${organizationId}
      AND account_type = 'employee'
      AND (joined_on IS NULL OR joined_on <= ${periodEnd}::date)
      AND (left_on IS NULL OR left_on >= ${periodStart}::date)
      AND (${onlyUserIds === undefined}::boolean OR id = ANY(${onlyUserIds ?? []}::uuid[]))
    ORDER BY id
  `);
  return rows.map((row) => ({
    ...row,
    employmentFrom: row.joinedOn ?? periodStart,
    employmentTo: row.leftOn,
  }));
}

export interface FrozenEmployee {
  readonly userId: string;
  readonly employmentFrom: string;
  readonly employmentTo: string | null;
  readonly inputs: FrozenEmployeeInputs;
  readonly fingerprint: string;
}

/** Build each employee's complete input set for the period, in one pass per source. */
export async function freezeEmployees(
  tx: Tx,
  organizationId: string,
  period: { readonly start: string; readonly end: string },
  config: PayrollConfigRow,
  employees: readonly PeriodEmployee[],
): Promise<FrozenEmployee[]> {
  if (employees.length === 0) return [];
  const userIds = employees.map((e) => e.userId);

  const snapshot = await AttFacade.snapshotPeriod(
    tx,
    userIds,
    period.start as DateOnly,
    period.end as DateOnly,
  );
  const daysByUser = new Map<string, FrozenDay[]>();
  for (const day of snapshot.days) {
    const list = daysByUser.get(day.userId) ?? [];
    list.push({
      workDate: day.workDate,
      state: day.state,
      presentUnits: day.presentUnits,
      paidLeaveUnits: day.paidLeaveUnits,
      unpaidLeaveUnits: day.unpaidLeaveUnits,
      absentUnits: day.absentUnits,
      holidayUnits: day.holidayUnits,
      nightMinutes: day.nightMinutes,
      overtimeMinutes: day.overtimeMinutes,
    });
    daysByUser.set(day.userId, list);
  }

  const segmentsByUser = await structureSegmentsForPeriod(tx, organizationId, userIds, period.start, period.end);

  const inputsByUser = new Map<string, PayrollInputRow[]>();
  for (const row of await listActiveInputsForPeriod(tx, organizationId, userIds, period.start)) {
    const list = inputsByUser.get(row.userId) ?? [];
    list.push(row);
    inputsByUser.set(row.userId, list);
  }

  const configSnapshot = { id: config.id, effectiveFrom: config.effectiveFrom, settings: config.settings };
  return employees.map((employee) => {
    const inputs: FrozenEmployeeInputs = {
      employmentFrom: employee.employmentFrom,
      employmentTo: employee.employmentTo,
      days: daysByUser.get(employee.userId) ?? [],
      structureSegments: segmentsByUser.get(employee.userId) ?? [],
      payrollInputs: inputsByUser.get(employee.userId) ?? [],
      configSnapshot,
    };
    return {
      userId: employee.userId,
      employmentFrom: employee.employmentFrom,
      employmentTo: employee.employmentTo,
      inputs,
      fingerprint: fingerprint(inputs),
    };
  });
}

/**
 * Every salary structure in effect on some day of the period, as the
 * calculation reads it. `effectiveTo` is exclusive, as in `salary_structure`.
 */
export async function structureSegmentsForPeriod(
  tx: Tx,
  organizationId: string,
  userIds: readonly string[],
  periodStart: string,
  periodEnd: string,
): Promise<Map<string, FrozenStructureSegment[]>> {
  const result = new Map<string, FrozenStructureSegment[]>();
  if (userIds.length === 0) return result;
  const structures = await tx.query<{
    id: string;
    userId: string;
    currency: string;
    effectiveFrom: string;
    effectiveTo: string | null;
  }>(sql`
    SELECT id, user_id AS "userId", currency, effective_from::text AS "effectiveFrom",
           effective_to::text AS "effectiveTo"
    FROM salary_structure
    WHERE organization_id = ${organizationId}
      AND user_id = ANY(${userIds}::uuid[])
      AND voided_at IS NULL
      AND effective_from <= ${periodEnd}::date
      AND (effective_to IS NULL OR effective_to > ${periodStart}::date)
    ORDER BY user_id, effective_from
  `);
  if (structures.length === 0) return result;
  const lines = await tx.query<{
    structureId: string;
    code: string;
    label: string;
    kind: FrozenStructureLine['kind'];
    amount: string;
    prorated: boolean;
    statutoryTags: string[];
    sortOrder: number;
  }>(sql`
    SELECT structure_id AS "structureId", code, label, kind, amount::text AS amount, prorated,
           statutory_tags AS "statutoryTags", sort_order AS "sortOrder"
    FROM salary_structure_line
    WHERE organization_id = ${organizationId}
      AND structure_id = ANY(${structures.map((s) => s.id)}::uuid[])
    ORDER BY structure_id, sort_order
  `);
  const linesByStructure = new Map<string, FrozenStructureLine[]>();
  for (const line of lines) {
    const list = linesByStructure.get(line.structureId) ?? [];
    list.push({
      code: line.code,
      label: line.label,
      kind: line.kind,
      amountStr: line.amount,
      prorated: line.prorated,
      statutoryTags: line.statutoryTags,
      sortOrder: line.sortOrder,
    });
    linesByStructure.set(line.structureId, list);
  }
  for (const structure of structures) {
    const list = result.get(structure.userId) ?? [];
    list.push({
      structureId: structure.id,
      currency: structure.currency.trim(),
      effectiveFrom: structure.effectiveFrom,
      effectiveTo: structure.effectiveTo,
      lines: linesByStructure.get(structure.id) ?? [],
    });
    result.set(structure.userId, list);
  }
  return result;
}

export type RunWarningKind = 'no-salary-structure' | 'no-leaving-date';

/** Not blockers: the run can be computed, but the result is probably not what HR means. */
export interface RunWarning {
  readonly userId: string;
  readonly fullName: string;
  readonly kind: RunWarningKind;
}

export function runWarnings(
  employees: readonly PeriodEmployee[],
  frozen: readonly FrozenEmployee[],
): RunWarning[] {
  const byUser = new Map(frozen.map((f) => [f.userId, f]));
  const warnings: RunWarning[] = [];
  for (const employee of employees) {
    const inputs = byUser.get(employee.userId)?.inputs;
    if (inputs !== undefined && inputs.structureSegments.length === 0)
      warnings.push({ userId: employee.userId, fullName: employee.fullName, kind: 'no-salary-structure' });
    if (employee.leftOn === null && (employee.accountStatus === 'inactive' || employee.accountStatus === 'offboarded'))
      warnings.push({ userId: employee.userId, fullName: employee.fullName, kind: 'no-leaving-date' });
  }
  return warnings;
}

/**
 * Only an organization with break management enabled evaluates closed days for
 * breaks; without it, requiring the evaluation would block every payroll.
 */
export async function breakEvaluationRequired(tx: Tx, organizationId: string): Promise<boolean> {
  const row = await tx.one<{ enabled: boolean }>(sql`
    SELECT EXISTS (
      SELECT 1
      FROM organization_module om
      JOIN module m ON m.id = om.module_id
      WHERE om.organization_id = ${organizationId}
        AND m.key = 'break-management'
        AND om.status = 'enabled'
    ) AS enabled
  `);
  return row.enabled;
}
