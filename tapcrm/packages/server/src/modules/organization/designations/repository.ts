import type { SqlFragment } from '@tapcrm/authz';
import type { RequestContext } from '../../../platform/dal/context.js';
import { db, type Tx } from '../../../platform/dal/db.js';
import { sql } from '../../../platform/dal/sql.js';

export interface DesignationRecord {
  id: string;
  organizationId: string;
  name: string;
  specializations: string[];
  status: 'active' | 'inactive';
  isSeeded: boolean;
}

export async function listDesignations(
  ctx: RequestContext,
  filter: SqlFragment,
): Promise<DesignationRecord[]> {
  return db.query<DesignationRecord>(
    ctx,
    sql`
    SELECT id, organization_id, name, specializations, status, is_seeded
    FROM designation WHERE organization_id = ${ctx.organizationId} AND ${filter} ORDER BY name
  `,
  );
}

export async function findDesignationByName(
  tx: Tx,
  organizationId: string,
  name: string,
  excludeId?: string,
): Promise<DesignationRecord | null> {
  return tx.maybeOne<DesignationRecord>(sql`
    SELECT id, organization_id, name, specializations, status, is_seeded FROM designation
    WHERE organization_id = ${organizationId} AND lower(name) = lower(${name})
      AND id <> COALESCE(${excludeId ?? null}, id)
  `);
}

export async function findDesignation(
  tx: Tx,
  organizationId: string,
  id: string,
): Promise<DesignationRecord | null> {
  return tx.maybeOne<DesignationRecord>(sql`
    SELECT id, organization_id, name, specializations, status, is_seeded
    FROM designation
    WHERE organization_id = ${organizationId} AND id = ${id}
  `);
}

export async function insertDesignation(
  tx: Tx,
  input: { organizationId: string; name: string; specializations: string[] },
): Promise<DesignationRecord> {
  return tx.one<DesignationRecord>(sql`
    INSERT INTO designation (organization_id, name, specializations)
    VALUES (${input.organizationId}, ${input.name}, ${input.specializations})
    RETURNING id, organization_id, name, specializations, status, is_seeded
  `);
}

export async function updateDesignation(
  tx: Tx,
  input: {
    organizationId: string;
    id: string;
    name: string;
    specializations: string[];
    status: 'active' | 'inactive';
  },
): Promise<DesignationRecord> {
  return tx.one<DesignationRecord>(sql`
    UPDATE designation
    SET name = ${input.name}, specializations = ${input.specializations}, status = ${input.status}
    WHERE organization_id = ${input.organizationId} AND id = ${input.id}
    RETURNING id, organization_id, name, specializations, status, is_seeded
  `);
}

export async function loadDesignationResource(ctx: RequestContext, id: string) {
  const row = await db.maybeOne<DesignationRecord>(
    ctx,
    sql`
    SELECT id, organization_id, name, specializations, status, is_seeded
    FROM designation
    WHERE organization_id = ${ctx.organizationId} AND id = ${id}
  `,
  );
  return row ? { ...row, type: 'designation' as const, id: row.id } : null;
}
