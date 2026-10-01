import type { SqlFragment } from '@tapcrm/authz';
import type { RequestContext } from '../../../platform/dal/context.js';
import { db, type Tx } from '../../../platform/dal/db.js';
import { sql } from '../../../platform/dal/sql.js';
import type { Territory, TerritoryDimension, TerritoryRule, TerritoryStatus } from './types.js';
import type { AssignmentStrategy, TerritoryCoverage } from './routing-types.js';

interface TerritoryRow extends Omit<Territory, 'rules' | 'createdAt' | 'updatedAt'> {
  createdAt: Date; updatedAt: Date; rules: TerritoryRule[] | null;
}

const SELECT = sql`
  SELECT st.id, st.organization_id AS "organizationId", st.name, st.description,
         st.sales_team_id AS "salesTeamId", t.name AS "salesTeamName",
         t.department_id AS "departmentId", st.status,
         st.created_by AS "createdBy", st.updated_by AS "updatedBy",
         st.created_at AS "createdAt", st.updated_at AS "updatedAt",
         COALESCE((SELECT json_agg(json_build_object(
           'id', r.id, 'dimension', r.dimension, 'value', r.value
         ) ORDER BY r.dimension, r.value)
         FROM sales_territory_rules r
         WHERE r.organization_id = st.organization_id AND r.territory_id = st.id), '[]'::json) AS rules
  FROM sales_territories st
  JOIN team t ON t.organization_id = st.organization_id AND t.id = st.sales_team_id
`;

export function mapTerritory(row: TerritoryRow): Territory {
  return { ...row, rules: row.rules ?? [], createdAt: new Date(row.createdAt), updatedAt: new Date(row.updatedAt) };
}

export async function listTerritories(ctx: RequestContext, filter: SqlFragment): Promise<Territory[]> {
  const rows = await db.query<TerritoryRow>(ctx, sql`${SELECT} WHERE st.organization_id = ${ctx.organizationId} AND ${filter} ORDER BY st.name`);
  return rows.map(mapTerritory);
}

/** Internal Leads integration: routing is tenant-scoped system work, not a user visibility query. */
export async function listTerritoriesForRouting(ctx: RequestContext): Promise<Territory[]> {
  const rows = await db.query<TerritoryRow>(ctx, sql`${SELECT} WHERE st.organization_id = ${ctx.organizationId} AND st.status = 'active' ORDER BY st.name`);
  return rows.map(mapTerritory);
}

export async function findTerritory(ctx: RequestContext, id: string): Promise<Territory | null> {
  const row = await db.maybeOne<TerritoryRow>(ctx, sql`${SELECT} WHERE st.organization_id = ${ctx.organizationId} AND st.id = ${id}`);
  return row ? mapTerritory(row) : null;
}

export async function findTerritoryTx(tx: Tx, organizationId: string, id: string): Promise<Territory | null> {
  const row = await tx.maybeOne<TerritoryRow>(sql`${SELECT} WHERE st.organization_id = ${organizationId} AND st.id = ${id}`);
  return row ? mapTerritory(row) : null;
}

export async function findTerritoryByName(tx: Tx, organizationId: string, name: string, excludeId?: string): Promise<boolean> {
  const row = await tx.maybeOne<{ id: string }>(sql`SELECT id FROM sales_territories WHERE organization_id = ${organizationId} AND lower(name) = lower(${name}) AND id <> COALESCE(${excludeId ?? null}, id) LIMIT 1`);
  return row !== null;
}

export async function insertTerritory(tx: Tx, input: { organizationId: string; name: string; description: string | null; salesTeamId: string; status: TerritoryStatus; actorId: string }): Promise<string> {
  const row = await tx.one<{ id: string }>(sql`INSERT INTO sales_territories (organization_id, name, description, sales_team_id, status, created_by, updated_by) VALUES (${input.organizationId}, ${input.name}, ${input.description}, ${input.salesTeamId}, ${input.status}, ${input.actorId}, ${input.actorId}) RETURNING id`);
  return row.id;
}

export async function updateTerritoryRow(tx: Tx, input: { organizationId: string; id: string; name: string; description: string | null; salesTeamId: string; status: TerritoryStatus; actorId: string }): Promise<void> {
  await tx.query(sql`UPDATE sales_territories SET name = ${input.name}, description = ${input.description}, sales_team_id = ${input.salesTeamId}, status = ${input.status}, updated_by = ${input.actorId} WHERE organization_id = ${input.organizationId} AND id = ${input.id}`);
}

export async function replaceRules(tx: Tx, organizationId: string, territoryId: string, rules: readonly { dimension: TerritoryDimension; value: string }[]): Promise<void> {
  await tx.query(sql`DELETE FROM sales_territory_rules WHERE organization_id = ${organizationId} AND territory_id = ${territoryId}`);
  for (const rule of rules) await tx.query(sql`INSERT INTO sales_territory_rules (organization_id, territory_id, dimension, value) VALUES (${organizationId}, ${territoryId}, ${rule.dimension}, ${rule.value})`);
}

export async function loadTerritoryResource(ctx: RequestContext, id: string) {
  const row = await db.maybeOne<{ id: string; organizationId: string; salesTeamId: string; departmentId: string }>(ctx, sql`SELECT st.id, st.organization_id AS "organizationId", st.sales_team_id AS "salesTeamId", t.department_id AS "departmentId" FROM sales_territories st JOIN team t ON t.organization_id = st.organization_id AND t.id = st.sales_team_id WHERE st.organization_id = ${ctx.organizationId} AND st.id = ${id}`);
  return row ? { type: 'territory' as const, ...row } : null;
}

export async function listTerritoryCoverage(
  ctx: RequestContext,
  filter: SqlFragment,
  routing: { enabled: boolean; assignmentStrategy: AssignmentStrategy },
): Promise<TerritoryCoverage[]> {
  const rows = await db.query<{
    territoryId: string; territoryName: string; territoryStatus: TerritoryStatus;
    salesTeamId: string; salesTeamName: string; salesPools: Array<{ id: string; name: string }> | null;
    rules: Array<{ dimension: TerritoryDimension; value: string }> | null;
  }>(ctx, sql`
    SELECT st.id AS "territoryId", st.name AS "territoryName", st.status AS "territoryStatus",
           st.sales_team_id AS "salesTeamId", t.name AS "salesTeamName",
           COALESCE((SELECT json_agg(json_build_object('id', pool.id, 'name', pool.name) ORDER BY pool.name)
                     FROM team pool
                     WHERE pool.organization_id = st.organization_id
                       AND pool.parent_team_id = st.sales_team_id
                       AND pool.kind = 'sales-pool'), '[]'::json) AS "salesPools",
           COALESCE((SELECT json_agg(json_build_object('dimension', r.dimension, 'value', r.value) ORDER BY r.dimension, r.value)
                     FROM sales_territory_rules r
                     WHERE r.organization_id = st.organization_id AND r.territory_id = st.id), '[]'::json) AS rules
    FROM sales_territories st
    JOIN team t ON t.organization_id = st.organization_id AND t.id = st.sales_team_id
    WHERE st.organization_id = ${ctx.organizationId} AND ${filter}
    ORDER BY st.name
  `);
  return rows.map((row) => ({
    territoryId: row.territoryId,
    territoryName: row.territoryName,
    territoryStatus: row.territoryStatus,
    salesTeamId: row.salesTeamId,
    salesTeamName: row.salesTeamName,
    salesPools: row.salesPools ?? [],
    rules: row.rules ?? [],
    routingEnabled: routing.enabled,
    assignmentStrategy: routing.assignmentStrategy,
    metrics: { activeAgents: null, punchedInAgents: null, openLeads: null, unroutedLeads: null },
  }));
}
