import type { SqlFragment } from '@tapcrm/authz';
import type { EmployeePrincipal } from '@tapcrm/contracts';
import type { RequestContext } from '../../../platform/dal/context.js';
import { db, type Tx } from '../../../platform/dal/db.js';
import { sql } from '../../../platform/dal/sql.js';
import { AUTHORIZATION_EVENTS } from '../../../platform/events.js';

export interface PositionRecord {
  id: string;
  organizationId: string;
  departmentId: string;
  code: string;
  name: string;
  organizationalLevel: number;
  parentPositionId: string | null;
  isSeeded: boolean;
  status: 'active' | 'inactive';
  maxDealValue: string | null;
  maxDiscountPercent: string | null;
  allowsCustomTerms: boolean;
}

export interface PositionTreeRecord extends PositionRecord {
  holderCount: number;
}

export interface PositionHolderRecord {
  id: string;
  fullName: string;
  email: string | null;
  departmentId: string | null;
  teamId: string | null;
  reportsTo: string | null;
  status: string;
}

export interface PositionPolicyRecord {
  id: string;
  organizationId: string;
  positionId: string;
  action: string;
  allowed: boolean;
  scope: string;
  fields: string[] | null;
  constraints: string[] | null;
}

export interface PositionImpactRecord {
  positionIds: string[];
  holderIds: string[];
  reportingRelationships: Array<{ userId: string; reportsTo: string | null }>;
}

export interface PositionParentChange {
  positionId: string;
  currentParentPositionId: string | null;
  proposedParentPositionId: string | null;
}

export interface PositionInsertionImpactRecord extends PositionImpactRecord {
  parentChanges: PositionParentChange[];
}

const positionColumns = sql.raw(`
  id, organization_id, department_id, code, name, organizational_level,
  parent_position_id, is_seeded, status, max_deal_value,
  max_discount_percent, allows_custom_terms
`);

export async function findPosition(
  tx: Tx,
  organizationId: string,
  id: string,
): Promise<PositionRecord | null> {
  return tx.maybeOne<PositionRecord>(sql`
    SELECT ${positionColumns}
    FROM position
    WHERE organization_id = ${organizationId} AND id = ${id}
  `);
}

export async function findPositionByCode(
  tx: Tx,
  organizationId: string,
  code: string,
): Promise<PositionRecord | null> {
  return tx.maybeOne<PositionRecord>(sql`
    SELECT ${positionColumns}
    FROM position
    WHERE organization_id = ${organizationId} AND code = ${code}
  `);
}

export async function findChildren(
  tx: Tx,
  organizationId: string,
  parentPositionId: string,
  excludeId?: string,
): Promise<PositionRecord[]> {
  return tx.query<PositionRecord>(sql`
    SELECT ${positionColumns}
    FROM position
    WHERE organization_id = ${organizationId}
      AND parent_position_id = ${parentPositionId}
      AND id <> COALESCE(${excludeId ?? null}, id)
    ORDER BY organizational_level DESC, name
  `);
}

export async function insertPosition(
  tx: Tx,
  input: {
    organizationId: string;
    departmentId: string;
    code: string;
    name: string;
    organizationalLevel: number;
    parentPositionId: string | null;
    status: string;
    maxDealValue: number | null;
    maxDiscountPercent: number | null;
    allowsCustomTerms: boolean;
  },
): Promise<PositionRecord> {
  return tx.one<PositionRecord>(sql`
    INSERT INTO position (
      organization_id, department_id, code, name, organizational_level,
      parent_position_id, is_seeded, status, max_deal_value,
      max_discount_percent, allows_custom_terms
    )
    VALUES (
      ${input.organizationId}, ${input.departmentId}, ${input.code}, ${input.name},
      ${input.organizationalLevel}, ${input.parentPositionId}, false, ${input.status},
      ${input.maxDealValue}, ${input.maxDiscountPercent}, ${input.allowsCustomTerms}
    )
    RETURNING ${positionColumns}
  `);
}

export async function updatePosition(
  tx: Tx,
  input: {
    organizationId: string;
    id: string;
    departmentId: string;
    name: string;
    organizationalLevel: number;
    parentPositionId: string | null;
    status: string;
    maxDealValue: number | null;
    maxDiscountPercent: number | null;
    allowsCustomTerms: boolean;
  },
): Promise<PositionRecord> {
  return tx.one<PositionRecord>(sql`
    UPDATE position
    SET department_id = ${input.departmentId}, name = ${input.name},
        organizational_level = ${input.organizationalLevel},
        parent_position_id = ${input.parentPositionId}, status = ${input.status},
        max_deal_value = ${input.maxDealValue},
        max_discount_percent = ${input.maxDiscountPercent},
        allows_custom_terms = ${input.allowsCustomTerms}
    WHERE organization_id = ${input.organizationId} AND id = ${input.id}
    RETURNING ${positionColumns}
  `);
}

export async function updatePositionParent(
  tx: Tx,
  input: { organizationId: string; id: string; parentPositionId: string },
): Promise<PositionRecord> {
  return tx.one<PositionRecord>(sql`
    UPDATE position
    SET parent_position_id = ${input.parentPositionId}
    WHERE organization_id = ${input.organizationId} AND id = ${input.id}
    RETURNING ${positionColumns}
  `);
}

export async function listPositionsTx(
  tx: Tx,
  organizationId: string,
  departmentId: string,
): Promise<PositionRecord[]> {
  return tx.query<PositionRecord>(sql`
    SELECT ${positionColumns}
    FROM position
    WHERE organization_id = ${organizationId} AND department_id = ${departmentId}
    ORDER BY organizational_level DESC, name
  `);
}

export async function listPositionsForDepartment(
  ctx: RequestContext,
  departmentId: string,
): Promise<PositionTreeRecord[]> {
  return db.query<PositionTreeRecord>(
    ctx,
    sql`
    SELECT ${sql.raw('p.id, p.organization_id, p.department_id, p.code, p.name, p.organizational_level, p.parent_position_id, p.is_seeded, p.status, p.max_deal_value, p.max_discount_percent, p.allows_custom_terms')},
           COUNT(u.id)::int AS holder_count
    FROM position p
    LEFT JOIN app_user u
      ON u.organization_id = p.organization_id
     AND u.position_id = p.id
     AND u.account_type = 'employee'
     AND u.status = 'active'
    WHERE p.organization_id = ${ctx.organizationId}
      AND p.department_id = ${departmentId}
      AND p.status = 'active'
    GROUP BY p.id
    ORDER BY p.organizational_level DESC, p.name
  `,
  );
}

export async function listPositionHolders(
  ctx: RequestContext,
  positionId: string,
  filter: SqlFragment,
): Promise<PositionHolderRecord[]> {
  return db.query<PositionHolderRecord>(
    ctx,
    sql`
    SELECT u.id, u.full_name, u.email, u.department_id, u.team_id, u.reports_to, u.status
    FROM app_user u
    WHERE u.organization_id = ${ctx.organizationId}
      AND u.position_id = ${positionId}
      AND u.account_type = 'employee'
      AND u.status = 'active'
      AND ${filter}
    ORDER BY u.full_name
  `,
  );
}

export async function loadPositionResource(ctx: RequestContext, id: string) {
  const row = await db.maybeOne<PositionRecord>(
    ctx,
    sql`
    SELECT ${positionColumns}
    FROM position
    WHERE organization_id = ${ctx.organizationId} AND id = ${id}
  `,
  );
  return row ? { ...row, type: 'position' as const, id: row.id } : null;
}

export async function listPositionPolicies(
  ctx: RequestContext,
  positionId: string,
): Promise<PositionPolicyRecord[]> {
  return db.query<PositionPolicyRecord>(
    ctx,
    sql`
    SELECT id, organization_id, position_id, action, allowed, scope, fields, constraints
    FROM position_policy
    WHERE organization_id = ${ctx.organizationId} AND position_id = ${positionId}
    ORDER BY action
  `,
  );
}

export async function listPositionPoliciesTx(
  tx: Tx,
  organizationId: string,
  positionId: string,
): Promise<PositionPolicyRecord[]> {
  return tx.query<PositionPolicyRecord>(sql`
    SELECT id, organization_id, position_id, action, allowed, scope, fields, constraints
    FROM position_policy
    WHERE organization_id = ${organizationId} AND position_id = ${positionId}
    ORDER BY action
  `);
}

export async function directPositionHolderIds(
  tx: Tx,
  organizationId: string,
  positionId: string,
): Promise<string[]> {
  const rows = await tx.query<{ id: string }>(sql`
    SELECT id FROM app_user
    WHERE organization_id = ${organizationId}
      AND position_id = ${positionId}
      AND account_type = 'employee'
      AND status = 'active'
    ORDER BY id
  `);
  return rows.map((row) => row.id);
}

/** Active employee principals used only to resolve the position holders' real scopes. */
export async function listActivePositionHolderPrincipals(
  tx: Tx,
  organizationId: string,
  positionId: string,
): Promise<EmployeePrincipal[]> {
  return tx.query<EmployeePrincipal>(sql`
    SELECT u.id, u.organization_id, u.session_version, u.position_id,
           u.department_id, u.team_id, u.reports_to, p.organizational_level,
           'employee'::text AS account_type
    FROM app_user u
    JOIN position p ON p.organization_id = u.organization_id AND p.id = u.position_id
    WHERE u.organization_id = ${organizationId}
      AND u.position_id = ${positionId}
      AND u.account_type = 'employee'
      AND u.status = 'active'
    ORDER BY u.id
  `);
}

export async function countActiveEmployeesInTeams(
  tx: Tx,
  organizationId: string,
  teamIds: readonly string[],
): Promise<number> {
  if (teamIds.length === 0) return 0;
  const row = await tx.one<{ count: string }>(sql`
    SELECT COUNT(*)::text AS count
    FROM app_user
    WHERE organization_id = ${organizationId}
      AND account_type = 'employee'
      AND status = 'active'
      AND team_id = ANY(${teamIds}::uuid[])
  `);
  return Number(row.count);
}

export async function countActiveEmployeesInDepartment(
  tx: Tx,
  organizationId: string,
  departmentId: string,
): Promise<number> {
  const row = await tx.one<{ count: string }>(sql`
    SELECT COUNT(*)::text AS count
    FROM app_user
    WHERE organization_id = ${organizationId}
      AND account_type = 'employee'
      AND status = 'active'
      AND department_id = ${departmentId}
  `);
  return Number(row.count);
}

export async function countActiveEmployees(
  tx: Tx,
  organizationId: string,
): Promise<number> {
  const row = await tx.one<{ count: string }>(sql`
    SELECT COUNT(*)::text AS count
    FROM app_user
    WHERE organization_id = ${organizationId}
      AND account_type = 'employee'
      AND status = 'active'
  `);
  return Number(row.count);
}

export async function replacePositionPolicies(
  tx: Tx,
  organizationId: string,
  positionId: string,
  policies: Array<{
    action: string;
    allowed: boolean;
    scope: string;
    fields: string[] | null;
    constraints: string[] | null;
  }>,
): Promise<PositionPolicyRecord[]> {
  await tx.query(sql`
    DELETE FROM position_policy
    WHERE organization_id = ${organizationId} AND position_id = ${positionId}
  `);
  for (const policy of policies) {
    await tx.query(sql`
      INSERT INTO position_policy (organization_id, position_id, action, allowed, scope, fields, constraints)
      VALUES (${organizationId}, ${positionId}, ${policy.action}, ${policy.allowed}, ${policy.scope}, ${policy.fields}, ${policy.constraints})
    `);
  }
  return tx.query<PositionPolicyRecord>(sql`
    SELECT id, organization_id, position_id, action, allowed, scope, fields, constraints
    FROM position_policy
    WHERE organization_id = ${organizationId} AND position_id = ${positionId}
    ORDER BY action
  `);
}

export async function positionImpact(
  tx: Tx,
  organizationId: string,
  positionId: string,
): Promise<PositionImpactRecord> {
  const rows = await tx.query<{ id: string }>(sql`
    WITH RECURSIVE position_tree AS (
      SELECT id
      FROM position
      WHERE organization_id = ${organizationId} AND id = ${positionId}
      UNION ALL
      SELECT child.id
      FROM position child
      JOIN position_tree parent ON child.parent_position_id = parent.id
      WHERE child.organization_id = ${organizationId}
    )
    SELECT id FROM position_tree
  `);
  const positionIds = rows.map((row) => row.id);
  if (positionIds.length === 0)
    return { positionIds: [], holderIds: [], reportingRelationships: [] };
  const holders = await tx.query<{ id: string; reportsTo: string | null }>(sql`
    SELECT id, reports_to
    FROM app_user
    WHERE organization_id = ${organizationId}
      AND account_type = 'employee'
      AND position_id = ANY(${positionIds}::uuid[])
      AND status = 'active'
  `);
  return {
    positionIds,
    holderIds: holders.map((holder) => holder.id),
    reportingRelationships: holders.map((holder) => ({
      userId: holder.id,
      reportsTo: holder.reportsTo,
    })),
  };
}

export async function positionInsertionImpact(
  tx: Tx,
  organizationId: string,
  parentPositionId: string | null,
  organizationalLevel: number,
  proposedParentPositionId: string | null,
): Promise<PositionInsertionImpactRecord> {
  if (parentPositionId === null) {
    return {
      positionIds: [],
      holderIds: [],
      reportingRelationships: [],
      parentChanges: [],
    };
  }
  const parentChanges = await tx.query<PositionParentChange>(sql`
    SELECT id AS position_id,
           parent_position_id AS current_parent_position_id,
           ${proposedParentPositionId} AS proposed_parent_position_id
    FROM position
    WHERE organization_id = ${organizationId}
      AND parent_position_id = ${parentPositionId}
      AND status = 'active'
      AND organizational_level < ${organizationalLevel}
    ORDER BY organizational_level DESC, name
  `);
  if (parentChanges.length === 0) {
    return { positionIds: [], holderIds: [], reportingRelationships: [], parentChanges };
  }
  const affected = await tx.query<{ id: string }>(sql`
    WITH RECURSIVE affected AS (
      SELECT id
      FROM position
      WHERE id = ANY(${parentChanges.map((change) => change.positionId)}::uuid[])
        AND organization_id = ${organizationId}
      UNION ALL
      SELECT child.id
      FROM position child
      JOIN affected parent ON child.parent_position_id = parent.id
      WHERE child.organization_id = ${organizationId}
    )
    SELECT id FROM affected
  `);
  const positionIds = affected.map((row) => row.id);
  const holders = await tx.query<{ id: string; reportsTo: string | null }>(sql`
    SELECT id, reports_to
    FROM app_user
    WHERE organization_id = ${organizationId}
      AND account_type = 'employee'
      AND position_id = ANY(${positionIds}::uuid[])
      AND status = 'active'
    ORDER BY id
  `);
  return {
    positionIds,
    holderIds: holders.map((holder) => holder.id),
    reportingRelationships: holders.map((holder) => ({
      userId: holder.id,
      reportsTo: holder.reportsTo,
    })),
    parentChanges,
  };
}

export async function enqueuePermissionsChanged(
  tx: Tx,
  input: {
    organizationId: string;
    positionId: string;
    holderIds: string[];
    reason: string;
  },
): Promise<void> {
  await tx.query(sql`
    INSERT INTO domain_outbox (organization_id, event_name, payload)
    VALUES (
      ${input.organizationId}, ${AUTHORIZATION_EVENTS.PERMISSIONS_CHANGED},
      ${JSON.stringify({
        positionId: input.positionId,
        holderIds: input.holderIds,
        reason: input.reason,
      })}::jsonb
    )
  `);
}
