import type { DateOnly, Decimal } from '@tapcrm/contracts';
import type { RequestContext } from '../../platform/dal/context.js';
import { db, type Tx } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import { addDays } from '../../platform/time.js';
import { writePayrollAudit } from './audit.js';
import {
  PAYROLL_ERROR_CODES,
  PayrollConflictError,
  PayrollNotFoundError,
  PayrollValidationError,
} from './errors.js';

export interface StructureLine {
  readonly code: string;
  readonly label: string;
  readonly kind: 'earning' | 'deduction' | 'employer-contribution';
  readonly amount: Decimal;
  readonly prorated: boolean;
  readonly statutoryTags: string[];
  readonly sortOrder: number;
}

export interface CreateStructureInput {
  readonly userId: string;
  readonly currency: string;
  readonly effectiveFrom: string;
  readonly effectiveTo?: string | null;
  readonly lines: StructureLine[];
  /**
   * Correct a structure entered by mistake: it is voided (kept, with the
   * reason) and this one takes its place from the same date. Refused once a
   * published payslip used it — a revision corrects that instead.
   */
  readonly replacesStructureId?: string | null;
  readonly reason?: string | null;
}

export interface CreateStructureResult {
  readonly id: string;
  /** The open-ended structure this one ends, if any: it now stops the day before. */
  readonly closedStructureId: string | null;
  readonly voidedStructureId: string | null;
}

export interface SalaryStructureRow {
  readonly id: string;
  readonly userId: string;
  readonly currency: string;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly createdAt: string;
  readonly voidedAt: string | null;
  readonly voidReason: string | null;
  /** A published payslip used it: it can no longer be corrected, only followed by a new salary. */
  readonly usedByPublishedPayslip: boolean;
  readonly lines: StructureLineRow[];
}

export interface StructureLineRow {
  readonly id: string;
  readonly code: string;
  readonly label: string;
  readonly kind: 'earning' | 'deduction' | 'employer-contribution';
  readonly amount: string;   // numeric string
  readonly prorated: boolean;
  readonly statutoryTags: string[];
  readonly sortOrder: number;
}

/** A person's salary history, newest first, voided corrections included. */
export async function listStructures(
  ctx: RequestContext,
  userId: string,
): Promise<SalaryStructureRow[]> {
  return db.transaction(ctx, async (tx) => {
    const structures = await tx.query<Omit<SalaryStructureRow, 'lines'>>(sql`
      SELECT s.id, s.user_id AS "userId", s.currency, s.effective_from::text AS "effectiveFrom",
             s.effective_to::text AS "effectiveTo", s.created_at::text AS "createdAt",
             s.voided_at::text AS "voidedAt", s.void_reason AS "voidReason",
             EXISTS (
               SELECT 1 FROM payslip_salary_use su
               JOIN payslip p ON p.organization_id = su.organization_id AND p.id = su.payslip_id
               WHERE su.organization_id = s.organization_id AND su.structure_id = s.id
                 AND p.status = 'published'
             ) AS "usedByPublishedPayslip"
      FROM salary_structure s
      WHERE s.organization_id = ${ctx.organizationId}
        AND s.user_id = ${userId}::uuid
      ORDER BY s.effective_from DESC, s.created_at DESC
    `);
    const lines = structures.length === 0
      ? []
      : await tx.query<StructureLineRow & { structureId: string }>(sql`
          SELECT id, structure_id AS "structureId", code, label, kind, amount::text AS amount, prorated,
                 statutory_tags AS "statutoryTags", sort_order AS "sortOrder"
          FROM salary_structure_line
          WHERE organization_id = ${ctx.organizationId}
            AND structure_id = ANY(${structures.map((s) => s.id)}::uuid[])
          ORDER BY structure_id, sort_order
        `);
    return structures.map((s) => ({
      ...s,
      lines: lines
        .filter((line) => line.structureId === s.id)
        .map(({ structureId: _structureId, ...line }) => line),
    }));
  });
}

export interface StructureSummaryRow {
  readonly userId: string;
  readonly fullName: string;
  readonly employeeCode: string | null;
  readonly departmentName: string | null;
  readonly accountStatus: string;
  readonly structureId: string | null;
  readonly currency: string | null;
  readonly effectiveFrom: string | null;
  readonly effectiveTo: string | null;
  /** Monthly totals of the structure in effect on `onDate`, before proration. */
  readonly earnings: string | null;
  readonly deductions: string | null;
  /** A later salary already recorded, if any. */
  readonly nextEffectiveFrom: string | null;
}

/**
 * Every current employee with the salary structure in effect on `onDate` —
 * the overview HR works from. Employees without one are listed too, so a
 * missing salary is visible before a run pays someone nothing.
 */
export async function listStructureSummaries(
  ctx: RequestContext,
  onDate: string,
): Promise<StructureSummaryRow[]> {
  return db.query<StructureSummaryRow>(ctx, sql`
    SELECT u.id AS "userId", u.full_name AS "fullName", u.employee_id AS "employeeCode",
           d.name AS "departmentName", u.status AS "accountStatus",
           s.id AS "structureId", s.currency, s.effective_from::text AS "effectiveFrom",
           s.effective_to::text AS "effectiveTo",
           (SELECT sum(l.amount)::text FROM salary_structure_line l
             WHERE l.organization_id = s.organization_id AND l.structure_id = s.id AND l.kind = 'earning') AS earnings,
           (SELECT sum(l.amount)::text FROM salary_structure_line l
             WHERE l.organization_id = s.organization_id AND l.structure_id = s.id AND l.kind = 'deduction') AS deductions,
           (SELECT min(n.effective_from)::text FROM salary_structure n
             WHERE n.organization_id = u.organization_id AND n.user_id = u.id
               AND n.voided_at IS NULL AND n.effective_from > ${onDate}::date) AS "nextEffectiveFrom"
    FROM app_user u
    LEFT JOIN department d ON d.organization_id = u.organization_id AND d.id = u.department_id
    LEFT JOIN LATERAL (
      SELECT * FROM salary_structure ss
      WHERE ss.organization_id = u.organization_id AND ss.user_id = u.id
        AND ss.voided_at IS NULL
        AND ss.effective_from <= ${onDate}::date
        AND (ss.effective_to IS NULL OR ss.effective_to > ${onDate}::date)
      ORDER BY ss.effective_from DESC
      LIMIT 1
    ) s ON true
    WHERE u.organization_id = ${ctx.organizationId}
      AND u.account_type = 'employee'
      AND (u.left_on IS NULL OR u.left_on >= ${onDate}::date)
    ORDER BY u.full_name, u.id
  `);
}

export async function resolveStructureForDate(
  tx: Tx,
  organizationId: string,
  userId: string,
  workDate: string,
): Promise<(Omit<SalaryStructureRow, 'lines' | 'voidedAt' | 'voidReason' | 'usedByPublishedPayslip'> & { lines: StructureLineRow[] }) | null> {
  const s = await tx.maybeOne<{ id: string; userId: string; currency: string; effectiveFrom: string; effectiveTo: string | null; createdAt: string }>(sql`
    SELECT id, user_id AS "userId", currency, effective_from::text AS "effectiveFrom",
           effective_to::text AS "effectiveTo", created_at::text AS "createdAt"
    FROM salary_structure
    WHERE organization_id = ${organizationId}
      AND user_id = ${userId}::uuid
      AND voided_at IS NULL
      AND effective_from <= ${workDate}::date
      AND (effective_to IS NULL OR effective_to > ${workDate}::date)
    ORDER BY effective_from DESC
    LIMIT 1
  `);
  if (!s) return null;
  const lines = await tx.query<StructureLineRow>(sql`
    SELECT id, code, label, kind, amount::text AS amount, prorated,
           statutory_tags AS "statutoryTags", sort_order AS "sortOrder"
    FROM salary_structure_line
    WHERE organization_id = ${organizationId}
      AND structure_id = ${s.id}::uuid
    ORDER BY sort_order
  `);
  return { ...s, lines };
}

function formatDate(date: string): string {
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${date}T12:00:00Z`),
  );
}

/** Line rules the database would otherwise reject with a constraint error. */
function validateLines(lines: readonly StructureLine[]): void {
  if (lines.length === 0) {
    throw new PayrollValidationError(PAYROLL_ERROR_CODES.STRUCTURE_INVALID, 'Add at least one salary line.');
  }
  const codes = new Set<string>();
  const orders = new Set<number>();
  for (const line of lines) {
    const code = line.code.trim().toUpperCase();
    if (codes.has(code)) {
      throw new PayrollValidationError(
        PAYROLL_ERROR_CODES.STRUCTURE_INVALID,
        `The code ${code} is used by more than one line. Give each line its own code.`,
      );
    }
    codes.add(code);
    if (orders.has(line.sortOrder)) {
      throw new PayrollValidationError(
        PAYROLL_ERROR_CODES.STRUCTURE_INVALID,
        'Two lines have the same position. Give each line its own order.',
      );
    }
    orders.add(line.sortOrder);
  }
  if (!lines.some((line) => line.kind === 'earning')) {
    throw new PayrollValidationError(PAYROLL_ERROR_CODES.STRUCTURE_INVALID, 'A salary needs at least one earning line.');
  }
}

/** Void a structure so a corrected one can take its place from the same date. */
async function voidForCorrection(
  tx: Tx,
  ctx: RequestContext,
  input: CreateStructureInput,
  structureId: string,
): Promise<{ effectiveTo: string | null }> {
  const target = await tx.maybeOne<{
    userId: string;
    effectiveFrom: string;
    effectiveTo: string | null;
    voidedAt: string | null;
    used: boolean;
  }>(sql`
    SELECT s.user_id AS "userId", s.effective_from::text AS "effectiveFrom",
           s.effective_to::text AS "effectiveTo", s.voided_at::text AS "voidedAt",
           EXISTS (
             SELECT 1 FROM payslip_salary_use su
             JOIN payslip p ON p.organization_id = su.organization_id AND p.id = su.payslip_id
             WHERE su.organization_id = s.organization_id AND su.structure_id = s.id
               AND p.status = 'published'
           ) AS used
    FROM salary_structure s
    WHERE s.organization_id = ${ctx.organizationId} AND s.id = ${structureId}::uuid
    FOR UPDATE
  `);
  if (!target || target.userId !== input.userId || target.voidedAt !== null) {
    throw new PayrollNotFoundError('The salary being corrected was not found for this employee');
  }
  if (target.used) {
    throw new PayrollConflictError(
      PAYROLL_ERROR_CODES.STRUCTURE_OVERLAP,
      'This salary was already paid in a published payslip, so it stays as history. ' +
        'Record the new salary from a later date, and revise the published payslip if it was wrong.',
    );
  }
  if (target.effectiveFrom !== input.effectiveFrom) {
    throw new PayrollValidationError(
      PAYROLL_ERROR_CODES.STRUCTURE_INVALID,
      `A corrected salary starts on the same date as the one it corrects (${formatDate(target.effectiveFrom)}).`,
    );
  }
  const reason = input.reason?.trim();
  if (!reason) {
    throw new PayrollValidationError(PAYROLL_ERROR_CODES.STRUCTURE_INVALID, 'Say why the salary is being corrected.');
  }
  await tx.query(sql`
    UPDATE salary_structure
    SET voided_at = now(), voided_by = ${ctx.principal.id}::uuid, void_reason = ${reason}
    WHERE organization_id = ${ctx.organizationId} AND id = ${structureId}::uuid
  `);
  return { effectiveTo: target.effectiveTo };
}

/**
 * Record a salary structure from `effectiveFrom`. A later structure replaces
 * the one in effect: the open-ended structure it follows now ends the day
 * before (history is kept, never overwritten). A structure starting on or
 * before an existing one's start would rewrite history and is refused, unless
 * it explicitly corrects that structure (`replacesStructureId`).
 */
export async function createStructure(
  ctx: RequestContext,
  input: CreateStructureInput,
): Promise<CreateStructureResult> {
  validateLines(input.lines);
  if (input.effectiveTo !== undefined && input.effectiveTo !== null && input.effectiveTo <= input.effectiveFrom) {
    throw new PayrollValidationError(
      PAYROLL_ERROR_CODES.STRUCTURE_INVALID,
      'The end date must be after the start date.',
    );
  }
  return db.transaction(ctx, async (tx) => {
    const person = await tx.maybeOne<{ accountType: string; fullName: string }>(sql`
      SELECT account_type AS "accountType", full_name AS "fullName"
      FROM app_user
      WHERE organization_id = ${ctx.organizationId} AND id = ${input.userId}::uuid
      FOR UPDATE
    `);
    if (!person || person.accountType !== 'employee') {
      throw new PayrollValidationError(
        PAYROLL_ERROR_CODES.NOT_AN_EMPLOYEE,
        'Salary structures can only be recorded for employees.',
      );
    }

    const voidedStructureId = input.replacesStructureId ?? null;
    // A correction keeps the corrected salary's end, if a later salary had set one.
    const correctedEnd = voidedStructureId === null
      ? null
      : (await voidForCorrection(tx, ctx, input, voidedStructureId)).effectiveTo;

    const existing = await tx.query<{ id: string; effectiveFrom: string; effectiveTo: string | null }>(sql`
      SELECT id, effective_from::text AS "effectiveFrom", effective_to::text AS "effectiveTo"
      FROM salary_structure
      WHERE organization_id = ${ctx.organizationId} AND user_id = ${input.userId}::uuid
        AND voided_at IS NULL
      ORDER BY effective_from
      FOR UPDATE
    `);
    const newEnd = input.effectiveTo ?? correctedEnd;
    let closedStructureId: string | null = null;
    for (const structure of existing) {
      const overlaps =
        (structure.effectiveTo === null || structure.effectiveTo > input.effectiveFrom) &&
        (newEnd === null || structure.effectiveFrom < newEnd);
      if (!overlaps) continue;
      // The open-ended structure in effect when this one starts: end it the day before.
      if (structure.effectiveTo === null && structure.effectiveFrom < input.effectiveFrom && newEnd === null) {
        await tx.query(sql`
          UPDATE salary_structure SET effective_to = ${input.effectiveFrom}::date
          WHERE organization_id = ${ctx.organizationId} AND id = ${structure.id}::uuid
        `);
        closedStructureId = structure.id;
        continue;
      }
      const until = structure.effectiveTo === null
        ? 'with no end date'
        : `until ${formatDate(addDays(structure.effectiveTo as DateOnly, -1))}`;
      throw new PayrollConflictError(
        PAYROLL_ERROR_CODES.STRUCTURE_OVERLAP,
        `${person.fullName} already has a salary starting ${formatDate(structure.effectiveFrom)} ${until}. ` +
          'A new salary must start after the current one starts; to fix a mistake, correct that salary instead.',
        { structureId: structure.id },
      );
    }

    const row = await tx.one<{ id: string }>(sql`
      INSERT INTO salary_structure
        (organization_id, user_id, currency, effective_from, effective_to, created_by)
      VALUES (
        ${ctx.organizationId}, ${input.userId}::uuid,
        ${input.currency}, ${input.effectiveFrom}::date,
        ${newEnd}::date, ${ctx.principal.id}
      )
      RETURNING id
    `);
    for (const line of input.lines) {
      await tx.query(sql`
        INSERT INTO salary_structure_line
          (organization_id, structure_id, code, label, kind, amount, prorated, statutory_tags, sort_order)
        VALUES (
          ${ctx.organizationId}, ${row.id}::uuid,
          ${line.code.trim().toUpperCase()}, ${line.label.trim()}, ${line.kind}, ${line.amount},
          ${line.prorated}, ${line.statutoryTags}::text[],
          ${line.sortOrder}
        )
      `);
    }
    await writePayrollAudit(tx, ctx, {
      action: voidedStructureId === null ? 'payroll.salary-structure-created' : 'payroll.salary-structure-corrected',
      targetType: 'salaryStructure',
      targetId: row.id,
      before: voidedStructureId === null ? null : { structureId: voidedStructureId },
      after: {
        userId: input.userId,
        effectiveFrom: input.effectiveFrom,
        effectiveTo: newEnd,
        lines: input.lines.length,
        closedStructureId,
      },
      reason: input.reason ?? null,
    });
    return { id: row.id, closedStructureId, voidedStructureId };
  });
}
