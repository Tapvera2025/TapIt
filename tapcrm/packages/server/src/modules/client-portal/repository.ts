import type { RequestContext } from '../../platform/dal/context.js';
import { db } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import type { PortalProfile, PortalProject, PortalService, PortalWorkStatus } from './types.js';

interface ProjectRow {
  id: string;
  name: string;
  description: string | null;
  workStatus: PortalWorkStatus;
  startDate: Date;
  expectedEndDate: Date | null;
  services: PortalService[];
  tasksDone: number;
  tasksScheduled: number;
}

/**
 * Every query here takes `clientId` from the authenticated principal and puts
 * it in the WHERE clause — A2 / CP-1: the filter runs before rows are read,
 * never after. Joining on `client.status = 'active'` means a deactivated
 * client sees nothing even if a token were somehow still live.
 */
const SELECT_PROJECT = sql`
  SELECT p.id, p.name, p.description, p.work_status, p.start_date, p.expected_end_date,
         COALESCE((
           SELECT json_agg(json_build_object('service', s.service, 'otherLabel', s.other_label) ORDER BY s.service)
           FROM project_service s
           WHERE s.organization_id = p.organization_id AND s.project_id = p.id
         ), '[]'::json) AS services,
         (SELECT count(*)::int FROM task t WHERE t.organization_id = p.organization_id AND t.project_id = p.id AND t.status = 'completed') AS "tasksDone",
         (SELECT count(*)::int FROM task t WHERE t.organization_id = p.organization_id AND t.project_id = p.id AND t.status <> 'cancelled') AS "tasksScheduled"
  FROM project p
  JOIN client c ON c.organization_id = p.organization_id AND c.id = p.client_id AND c.status = 'active'
`;

const toProject = (row: ProjectRow): PortalProject => ({
  id: row.id,
  name: row.name,
  description: row.description,
  workStatus: row.workStatus,
  startDate: row.startDate,
  expectedEndDate: row.expectedEndDate,
  services: row.services,
  progress: { completed: row.tasksDone, scheduled: row.tasksScheduled },
});

export async function findProfile(ctx: RequestContext, clientId: string): Promise<PortalProfile | null> {
  return db.maybeOne<PortalProfile>(ctx, sql`
    SELECT c.client_name, c.business_name, c.email, c.region, c.timezone, o.name AS "organizationName"
    FROM client c
    JOIN organization o ON o.id = c.organization_id
    WHERE c.organization_id = ${ctx.organizationId} AND c.id = ${clientId} AND c.status = 'active'
  `);
}

export async function listProjects(ctx: RequestContext, clientId: string, limit = 200): Promise<PortalProject[]> {
  const rows = await db.query<ProjectRow>(ctx, sql`
    ${SELECT_PROJECT}
    WHERE p.organization_id = ${ctx.organizationId} AND p.client_id = ${clientId} AND p.archived_at IS NULL
    ORDER BY p.created_at DESC
    LIMIT ${limit}
  `);
  return rows.map(toProject);
}

export async function findProject(ctx: RequestContext, clientId: string, projectId: string): Promise<PortalProject | null> {
  const row = await db.maybeOne<ProjectRow>(ctx, sql`
    ${SELECT_PROJECT}
    WHERE p.organization_id = ${ctx.organizationId} AND p.client_id = ${clientId}
      AND p.id = ${projectId} AND p.archived_at IS NULL
  `);
  return row ? toProject(row) : null;
}

/** Returns a project's active shared discussion only when the portal user is a current member. */
export async function findProjectDiscussion(ctx: RequestContext, clientId: string, projectId: string, userId: string): Promise<string | null> {
  const row = await db.maybeOne<{ id: string }>(ctx, sql`
    SELECT c.id
    FROM project p
    JOIN client cl ON cl.organization_id = p.organization_id AND cl.id = p.client_id AND cl.status = 'active'
    JOIN conversation c ON c.organization_id = p.organization_id AND c.project_id = p.id
      AND c.kind = 'project' AND c.archived_at IS NULL
    JOIN conversation_member cm ON cm.organization_id = c.organization_id AND cm.conversation_id = c.id
      AND cm.user_id = ${userId} AND cm.left_at IS NULL
    JOIN app_user u ON u.organization_id = cm.organization_id AND u.id = cm.user_id
      AND u.status = 'active' AND u.account_type = 'client' AND u.client_id = cl.id
    WHERE p.organization_id = ${ctx.organizationId} AND p.client_id = ${clientId}
      AND p.id = ${projectId} AND p.archived_at IS NULL
    ORDER BY c.created_at, c.id
    LIMIT 1
  `);
  return row?.id ?? null;
}

/** Every project discussion the authenticated client is currently entitled to see. */
export async function listProjectDiscussions(ctx: RequestContext, clientId: string, userId: string): Promise<{ conversationId: string; projectId: string; projectName: string }[]> {
  return db.query<{ conversationId: string; projectId: string; projectName: string }>(ctx, sql`
    SELECT DISTINCT ON (p.id) c.id AS "conversationId", p.id AS "projectId", p.name AS "projectName"
    FROM project p
    JOIN client cl ON cl.organization_id = p.organization_id AND cl.id = p.client_id AND cl.status = 'active'
    JOIN conversation c ON c.organization_id = p.organization_id AND c.project_id = p.id
      AND c.kind = 'project' AND c.archived_at IS NULL
    JOIN conversation_member cm ON cm.organization_id = c.organization_id AND cm.conversation_id = c.id
      AND cm.user_id = ${userId} AND cm.left_at IS NULL
    JOIN app_user u ON u.organization_id = cm.organization_id AND u.id = cm.user_id
      AND u.status = 'active' AND u.account_type = 'client' AND u.client_id = cl.id
    WHERE p.organization_id = ${ctx.organizationId} AND p.client_id = ${clientId} AND p.archived_at IS NULL
    ORDER BY p.id, c.created_at, c.id
  `);
}

export async function countProjectsByStatus(ctx: RequestContext, clientId: string): Promise<Record<PortalWorkStatus, number>> {
  const rows = await db.query<{ workStatus: PortalWorkStatus; count: number }>(ctx, sql`
    SELECT p.work_status, count(*)::int AS count
    FROM project p
    JOIN client c ON c.organization_id = p.organization_id AND c.id = p.client_id AND c.status = 'active'
    WHERE p.organization_id = ${ctx.organizationId} AND p.client_id = ${clientId} AND p.archived_at IS NULL
    GROUP BY p.work_status
  `);
  const counts: Record<PortalWorkStatus, number> = { new: 0, ongoing: 0, ended: 0, expired: 0 };
  for (const row of rows) counts[row.workStatus] = row.count;
  return counts;
}
