import type { SqlFragment } from '@tapcrm/authz';
import type { RequestContext } from '../../../platform/dal/context.js';
import { db, type Tx } from '../../../platform/dal/db.js';
import { sql } from '../../../platform/dal/sql.js';

export interface DepartmentRecord {
  id: string;
  organizationId: string;
  code: string;
  name: string;
  kind: string;
  status: 'active' | 'inactive';
  isSeeded: boolean;
}

export async function listDepartments(
  ctx: RequestContext,
  filter: SqlFragment,
): Promise<DepartmentRecord[]> {
  return db.query<DepartmentRecord>(
    ctx,
    sql`
    SELECT id, organization_id, code, name, kind, status, is_seeded
    FROM department
    WHERE organization_id = ${ctx.organizationId} AND ${filter}
    ORDER BY code
  `,
  );
}

export async function findDepartment(
  tx: Tx,
  organizationId: string,
  id: string,
): Promise<DepartmentRecord | null> {
  return tx.maybeOne<DepartmentRecord>(sql`
    SELECT id, organization_id, code, name, kind, status, is_seeded
    FROM department WHERE organization_id = ${organizationId} AND id = ${id}
  `);
}

export async function findDepartmentByCode(
  tx: Tx,
  organizationId: string,
  code: string,
): Promise<DepartmentRecord | null> {
  return tx.maybeOne<DepartmentRecord>(sql`
    SELECT id, organization_id, code, name, kind, status, is_seeded
    FROM department WHERE organization_id = ${organizationId} AND code = ${code}
  `);
}

export async function insertDepartment(
  tx: Tx,
  input: {
    organizationId: string;
    code: string;
    name: string;
    kind: string;
    status: string;
  },
): Promise<DepartmentRecord> {
  return tx.one<DepartmentRecord>(sql`
    INSERT INTO department (organization_id, code, name, kind, status)
    VALUES (${input.organizationId}, ${input.code}, ${input.name}, ${input.kind}, ${input.status})
    RETURNING id, organization_id, code, name, kind, status, is_seeded
  `);
}

export async function updateDepartment(
  tx: Tx,
  input: { organizationId: string; id: string; name?: string; status?: string },
): Promise<DepartmentRecord> {
  return tx.one<DepartmentRecord>(sql`
    UPDATE department
    SET name = COALESCE(${input.name ?? null}, name), status = COALESCE(${input.status ?? null}, status)
    WHERE organization_id = ${input.organizationId} AND id = ${input.id}
    RETURNING id, organization_id, code, name, kind, status, is_seeded
  `);
}

export async function loadDepartmentResource(ctx: RequestContext, id: string) {
  const row = await db.maybeOne<DepartmentRecord>(
    ctx,
    sql`
    SELECT id, organization_id, code, name, kind, status, is_seeded
    FROM department WHERE organization_id = ${ctx.organizationId} AND id = ${id}
  `,
  );
  return row ? { ...row, type: 'department' as const, id: row.id } : null;
}
