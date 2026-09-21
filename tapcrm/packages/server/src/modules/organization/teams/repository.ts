import type { SqlFragment } from '@tapcrm/authz';
import type { RequestContext } from '../../../platform/dal/context.js';
import { db, type Tx } from '../../../platform/dal/db.js';
import { sql } from '../../../platform/dal/sql.js';

export interface TeamRecord {
  id: string;
  organizationId: string;
  departmentId: string;
  kind: string;
  name: string;
  leadUserId: string | null;
  parentTeamId: string | null;
  sharedVisibility: boolean;
  isSeeded: boolean;
}

export async function listTeams(
  ctx: RequestContext,
  filter: SqlFragment,
): Promise<TeamRecord[]> {
  return db.query<TeamRecord>(
    ctx,
    sql`
    SELECT id, organization_id, department_id, kind, name, lead_user_id, parent_team_id, shared_visibility, is_seeded
    FROM team WHERE organization_id = ${ctx.organizationId} AND ${filter} ORDER BY name
  `,
  );
}

export async function findTeam(
  tx: Tx,
  organizationId: string,
  id: string,
): Promise<TeamRecord | null> {
  return tx.maybeOne<TeamRecord>(sql`
    SELECT id, organization_id, department_id, kind, name, lead_user_id, parent_team_id, shared_visibility, is_seeded
    FROM team WHERE organization_id = ${organizationId} AND id = ${id}
  `);
}

export async function findTeamByName(
  tx: Tx,
  organizationId: string,
  departmentId: string,
  name: string,
  excludeId?: string,
): Promise<TeamRecord | null> {
  return tx.maybeOne<TeamRecord>(sql`
    SELECT id, organization_id, department_id, kind, name, lead_user_id, parent_team_id, shared_visibility, is_seeded
    FROM team
    WHERE organization_id = ${organizationId} AND department_id = ${departmentId}
      AND lower(name) = lower(${name}) AND id <> COALESCE(${excludeId ?? null}, id)
  `);
}

export async function insertTeam(
  tx: Tx,
  input: {
    organizationId: string;
    departmentId: string;
    kind: string;
    name: string;
    leadUserId: string | null;
    parentTeamId: string | null;
    sharedVisibility: boolean;
  },
): Promise<TeamRecord> {
  return tx.one<TeamRecord>(sql`
    INSERT INTO team (organization_id, department_id, kind, name, lead_user_id, parent_team_id, shared_visibility)
    VALUES (${input.organizationId}, ${input.departmentId}, ${input.kind}, ${input.name}, ${input.leadUserId}, ${input.parentTeamId}, ${input.sharedVisibility})
    RETURNING id, organization_id, department_id, kind, name, lead_user_id, parent_team_id, shared_visibility, is_seeded
  `);
}

export async function updateTeam(
  tx: Tx,
  input: {
    organizationId: string;
    id: string;
    departmentId: string;
    kind: string;
    name: string;
    leadUserId: string | null;
    parentTeamId: string | null;
    sharedVisibility: boolean;
  },
): Promise<TeamRecord> {
  return tx.one<TeamRecord>(sql`
    UPDATE team SET department_id = ${input.departmentId}, kind = ${input.kind}, name = ${input.name}, lead_user_id = ${input.leadUserId}, parent_team_id = ${input.parentTeamId}, shared_visibility = ${input.sharedVisibility}
    WHERE organization_id = ${input.organizationId} AND id = ${input.id}
    RETURNING id, organization_id, department_id, kind, name, lead_user_id, parent_team_id, shared_visibility, is_seeded
  `);
}

export async function countActiveTeamMembers(
  tx: Tx,
  organizationId: string,
  teamId: string,
): Promise<number> {
  const row = await tx.one<{ count: string }>(sql`
    SELECT COUNT(*)::text AS count
    FROM app_user
    WHERE organization_id = ${organizationId}
      AND team_id = ${teamId}
      AND account_type = 'employee'
      AND status = 'active'
  `);
  return Number(row.count);
}

export async function countChildTeams(
  tx: Tx,
  organizationId: string,
  teamId: string,
): Promise<number> {
  const row = await tx.one<{ count: string }>(sql`
    SELECT COUNT(*)::text AS count
    FROM team
    WHERE organization_id = ${organizationId} AND parent_team_id = ${teamId}
  `);
  return Number(row.count);
}

export async function findUser(tx: Tx, organizationId: string, id: string) {
  return tx.maybeOne<{
    id: string;
    organizationId: string;
    accountType: string;
    status: string;
    departmentId: string | null;
    teamId: string | null;
    positionCode: string | null;
    positionStatus: string | null;
  }>(sql`
    SELECT u.id, u.organization_id, u.account_type, u.status, u.department_id, u.team_id,
           p.code AS position_code, p.status AS position_status
    FROM app_user u
    LEFT JOIN position p
      ON p.organization_id = u.organization_id AND p.id = u.position_id
    WHERE u.organization_id = ${organizationId} AND u.id = ${id}
  `);
}

export async function assignUserToTeam(
  tx: Tx,
  organizationId: string,
  userId: string,
  teamId: string,
): Promise<{ id: string; teamId: string | null }> {
  return tx.one<{ id: string; teamId: string | null }>(sql`
    UPDATE app_user SET team_id = ${teamId}
    WHERE organization_id = ${organizationId} AND id = ${userId}
    RETURNING id, team_id
  `);
}

export async function loadTeamResource(ctx: RequestContext, id: string) {
  const row = await db.maybeOne<TeamRecord>(
    ctx,
    sql`
    SELECT id, organization_id, department_id, kind, name, lead_user_id, parent_team_id, shared_visibility, is_seeded
    FROM team WHERE organization_id = ${ctx.organizationId} AND id = ${id}
  `,
  );
  return row ? { ...row, type: 'team' as const, id: row.id } : null;
}
