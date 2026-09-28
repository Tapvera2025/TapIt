import type { RequestContext } from '../../platform/dal/context.js';
import { db, type Tx } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';

export interface StructureLine {
  readonly code: string;
  readonly label: string;
  readonly kind: 'earning' | 'deduction' | 'employer-contribution';
  readonly amount: number;  // stored as numeric, represents full rupees for display
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
}

export interface SalaryStructureRow {
  readonly id: string;
  readonly userId: string;
  readonly currency: string;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly createdAt: string;
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

export async function listStructures(
  ctx: RequestContext,
  userId: string,
): Promise<SalaryStructureRow[]> {
  return db.transaction(ctx, async (tx) => {
    const structures = await tx.query<Omit<SalaryStructureRow, 'lines'>>(sql`
      SELECT id, user_id AS "userId", currency, effective_from::text AS "effectiveFrom",
             effective_to::text AS "effectiveTo", created_at::text AS "createdAt"
      FROM salary_structure
      WHERE organization_id = ${ctx.organizationId}
        AND user_id = ${userId}::uuid
      ORDER BY effective_from DESC
    `);
    const result: SalaryStructureRow[] = [];
    for (const s of structures) {
      const lines = await tx.query<StructureLineRow>(sql`
        SELECT id, code, label, kind, amount::text AS amount, prorated,
               statutory_tags AS "statutoryTags", sort_order AS "sortOrder"
        FROM salary_structure_line
        WHERE organization_id = ${ctx.organizationId}
          AND structure_id = ${s.id}::uuid
        ORDER BY sort_order
      `);
      result.push({ ...s, lines });
    }
    return result;
  });
}

export async function resolveStructureForDate(
  tx: Tx,
  organizationId: string,
  userId: string,
  workDate: string,
): Promise<(Omit<SalaryStructureRow, 'lines'> & { lines: StructureLineRow[] }) | null> {
  const s = await tx.maybeOne<Omit<SalaryStructureRow, 'lines'>>(sql`
    SELECT id, user_id AS "userId", currency, effective_from::text AS "effectiveFrom",
           effective_to::text AS "effectiveTo", created_at::text AS "createdAt"
    FROM salary_structure
    WHERE organization_id = ${organizationId}
      AND user_id = ${userId}::uuid
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

export async function createStructure(
  ctx: RequestContext,
  input: CreateStructureInput,
): Promise<{ id: string }> {
  return db.transaction(ctx, async (tx) => {
    const row = await tx.one<{ id: string }>(sql`
      INSERT INTO salary_structure
        (organization_id, user_id, currency, effective_from, effective_to, created_by)
      VALUES (
        ${ctx.organizationId}, ${input.userId}::uuid,
        ${input.currency}, ${input.effectiveFrom}::date,
        ${input.effectiveTo ?? null}::date, ${ctx.principal.id}
      )
      RETURNING id
    `);
    for (const line of input.lines) {
      await tx.query(sql`
        INSERT INTO salary_structure_line
          (organization_id, structure_id, code, label, kind, amount, prorated, statutory_tags, sort_order)
        VALUES (
          ${ctx.organizationId}, ${row.id}::uuid,
          ${line.code}, ${line.label}, ${line.kind}, ${line.amount},
          ${line.prorated}, ${JSON.stringify(line.statutoryTags)}::jsonb,
          ${line.sortOrder}
        )
      `);
    }
    return { id: row.id };
  });
}
