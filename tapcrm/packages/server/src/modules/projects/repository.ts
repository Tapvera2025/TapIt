import type { SqlFragment } from '@tapcrm/authz';
import type { RequestContext } from '../../platform/dal/context.js';
import { db, type Tx } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import type {
  Project,
  ProjectAssignee,
  ProjectListQuery,
  ProjectPriority,
  ProjectService,
  ProjectServiceInput,
  ProjectWorkStatus,
  PaginatedProjects,
} from './types.js';

interface ProjectRow {
  id: string;
  organizationId: string;
  clientId: string;
  clientName: string;
  businessName: string;
  name: string;
  priority: ProjectPriority;
  workStatus: ProjectWorkStatus;
  startDate: Date;
  expectedEndDate: Date | null;
  budget: string | null;
  currency: string;
  description: string | null;
  remarks: string | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
}

const SELECT_PROJECT = sql`
  SELECT p.id, p.organization_id, p.client_id, c.client_name, c.business_name, p.name, p.priority, p.work_status,
         p.start_date, p.expected_end_date, p.budget, p.currency, p.description, p.remarks,
         p.created_by, p.created_at, p.updated_at, p.archived_at
  FROM project p
  JOIN client c ON c.organization_id = p.organization_id AND c.id = p.client_id
`;

async function servicesFor(ctx: RequestContext, projectIds: readonly string[]): Promise<Map<string, ProjectService[]>> {
  if (projectIds.length === 0) return new Map();
  const rows = await db.query<{ projectId: string; id: string; service: ProjectService['service']; otherLabel: string | null }>(ctx, sql`
    SELECT project_id AS "projectId", id, service, other_label AS "otherLabel"
    FROM project_service WHERE organization_id = ${ctx.organizationId} AND project_id = ANY(${[...projectIds]}::uuid[])
    ORDER BY service
  `);
  const byProject = new Map<string, ProjectService[]>();
  for (const row of rows) {
    const list = byProject.get(row.projectId) ?? [];
    list.push({ id: row.id, service: row.service, otherLabel: row.otherLabel });
    byProject.set(row.projectId, list);
  }
  return byProject;
}

async function assigneesFor(ctx: RequestContext, projectIds: readonly string[]): Promise<Map<string, ProjectAssignee[]>> {
  if (projectIds.length === 0) return new Map();
  const rows = await db.query<{ projectId: string } & ProjectAssignee>(ctx, sql`
    SELECT pa.project_id AS "projectId", pa.user_id AS "userId", pa.assigned_at AS "assignedAt", u.full_name AS "fullName"
    FROM project_assignee pa
    JOIN app_user u ON u.organization_id = pa.organization_id AND u.id = pa.user_id
    WHERE pa.organization_id = ${ctx.organizationId} AND pa.project_id = ANY(${[...projectIds]}::uuid[])
    ORDER BY u.full_name
  `);
  const byProject = new Map<string, ProjectAssignee[]>();
  for (const row of rows) {
    const list = byProject.get(row.projectId) ?? [];
    list.push({ userId: row.userId, fullName: row.fullName, assignedAt: row.assignedAt });
    byProject.set(row.projectId, list);
  }
  return byProject;
}

/**
 * Read-only cross-reference into the `chat` module's table (Phase 2/3): "has
 * this project's discussion group been created yet" — the wizard's second
 * step. A plain SELECT against another module's table, never its repository/
 * service/policy (§3's actual boundary), and never a write.
 */
async function discussionConversationIdsFor(ctx: RequestContext, projectIds: readonly string[]): Promise<Map<string, string>> {
  if (projectIds.length === 0) return new Map();
  const rows = await db.query<{ projectId: string; id: string }>(ctx, sql`
    SELECT project_id AS "projectId", id FROM conversation
    WHERE organization_id = ${ctx.organizationId} AND kind = 'project' AND project_id = ANY(${[...projectIds]}::uuid[])
  `);
  return new Map(rows.map((r) => [r.projectId, r.id]));
}

function toProject(
  row: ProjectRow,
  services: Map<string, ProjectService[]>,
  assignees: Map<string, ProjectAssignee[]>,
  discussionIds: Map<string, string>,
): Project {
  return {
    id: row.id,
    organizationId: row.organizationId,
    clientId: row.clientId,
    clientName: row.clientName,
    businessName: row.businessName,
    name: row.name,
    priority: row.priority,
    workStatus: row.workStatus,
    startDate: row.startDate,
    expectedEndDate: row.expectedEndDate,
    budget: row.budget as Project['budget'],
    currency: row.currency,
    description: row.description,
    remarks: row.remarks,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    archivedAt: row.archivedAt,
    services: services.get(row.id) ?? [],
    assignees: assignees.get(row.id) ?? [],
    discussionConversationId: discussionIds.get(row.id) ?? null,
  };
}

export async function listProjects(ctx: RequestContext, filter: SqlFragment, query: ProjectListQuery): Promise<PaginatedProjects> {
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 20));
  const search = query.search?.trim();
  const clauses = [
    query.clientId ? sql`AND p.client_id = ${query.clientId}` : sql``,
    query.priority && query.priority !== 'all' ? sql`AND p.priority = ${query.priority}` : sql``,
    query.workStatus && query.workStatus !== 'all' ? sql`AND p.work_status = ${query.workStatus}` : sql``,
    search ? sql`AND (p.name ILIKE ${`%${search}%`} OR c.client_name ILIKE ${`%${search}%`} OR c.business_name ILIKE ${`%${search}%`})` : sql``,
    sql`AND p.archived_at IS NULL`,
  ];
  const extra = sql.join(clauses, ' ');

  const [rows, totalRow] = await Promise.all([
    db.query<ProjectRow>(ctx, sql`
      ${SELECT_PROJECT}
      WHERE p.organization_id = ${ctx.organizationId} AND (${filter}) ${extra}
      ORDER BY p.created_at DESC
      LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
    `),
    db.one<{ count: string }>(ctx, sql`
      SELECT count(*)::text AS count FROM project p
      JOIN client c ON c.organization_id = p.organization_id AND c.id = p.client_id
      WHERE p.organization_id = ${ctx.organizationId} AND (${filter}) ${extra}
    `),
  ]);

  const ids = rows.map((r) => r.id);
  const [services, assignees, discussionIds] = await Promise.all([servicesFor(ctx, ids), assigneesFor(ctx, ids), discussionConversationIdsFor(ctx, ids)]);
  const total = Number(totalRow.count);
  return { items: rows.map((row) => toProject(row, services, assignees, discussionIds)), total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

export async function findProjectById(ctx: RequestContext, id: string): Promise<Project | null> {
  const row = await db.maybeOne<ProjectRow>(ctx, sql`${SELECT_PROJECT} WHERE p.organization_id = ${ctx.organizationId} AND p.id = ${id}`);
  if (!row) return null;
  const [services, assignees, discussionIds] = await Promise.all([servicesFor(ctx, [id]), assigneesFor(ctx, [id]), discussionConversationIdsFor(ctx, [id])]);
  return toProject(row, services, assignees, discussionIds);
}

/** For the policy's `check()` (object-level, via `loadResource`) and for the notification audience. */
export async function findProjectAssigneeIds(ctx: RequestContext, id: string): Promise<string[]> {
  const rows = await db.query<{ userId: string }>(ctx, sql`
    SELECT user_id AS "userId" FROM project_assignee WHERE organization_id = ${ctx.organizationId} AND project_id = ${id}
  `);
  return rows.map((r) => r.userId);
}

export async function insertProject(
  tx: Tx,
  organizationId: string,
  createdBy: string,
  input: {
    clientId: string; name: string; priority: ProjectPriority; workStatus: ProjectWorkStatus;
    startDate: string; expectedEndDate: string | null; budget: string | null; currency: string;
    description: string | null; remarks: string | null;
  },
): Promise<{ id: string }> {
  return tx.one<{ id: string }>(sql`
    INSERT INTO project (organization_id, client_id, name, priority, work_status, start_date, expected_end_date, budget, currency, description, remarks, created_by)
    VALUES (${organizationId}, ${input.clientId}, ${input.name}, ${input.priority}, ${input.workStatus}, ${input.startDate}::date,
            ${input.expectedEndDate}::date, ${input.budget}::numeric, ${input.currency}, ${input.description}, ${input.remarks}, ${createdBy})
    RETURNING id
  `);
}

export async function insertProjectServices(tx: Tx, organizationId: string, projectId: string, services: readonly ProjectServiceInput[]): Promise<void> {
  for (const service of services) {
    await tx.query(sql`
      INSERT INTO project_service (organization_id, project_id, service, other_label)
      VALUES (${organizationId}, ${projectId}, ${service.service}, ${service.otherLabel ?? null})
    `);
  }
}

export async function replaceProjectServices(tx: Tx, organizationId: string, projectId: string, services: readonly ProjectServiceInput[]): Promise<void> {
  await tx.query(sql`DELETE FROM project_service WHERE organization_id = ${organizationId} AND project_id = ${projectId}`);
  await insertProjectServices(tx, organizationId, projectId, services);
}

export async function replaceProjectAssignees(tx: Tx, organizationId: string, projectId: string, userIds: readonly string[], assignedBy: string): Promise<void> {
  await tx.query(sql`DELETE FROM project_assignee WHERE organization_id = ${organizationId} AND project_id = ${projectId}`);
  if (userIds.length === 0) return;
  await tx.query(sql`
    INSERT INTO project_assignee (organization_id, project_id, user_id, assigned_by)
    SELECT ${organizationId}, ${projectId}, u, ${assignedBy} FROM unnest(${[...userIds]}::uuid[]) AS u
  `);
}

/** Every id, active-status or not, is checked at the call site — a departed employee cannot be assigned. */
export async function validateAssigneeIds(tx: Tx, organizationId: string, userIds: readonly string[]): Promise<string[]> {
  if (userIds.length === 0) return [];
  const rows = await tx.query<{ id: string }>(sql`
    SELECT id FROM app_user WHERE organization_id = ${organizationId} AND id = ANY(${[...userIds]}::uuid[]) AND status = 'active' AND account_type = 'employee'
  `);
  return rows.map((r) => r.id);
}

export async function updateProjectRow(
  tx: Tx,
  organizationId: string,
  id: string,
  input: {
    name?: string; priority?: ProjectPriority; workStatus?: ProjectWorkStatus; startDate?: string;
    expectedEndDate?: string | null; budget?: string | null; description?: string | null; remarks?: string | null;
  },
): Promise<void> {
  await tx.query(sql`
    UPDATE project SET
      name = COALESCE(${input.name ?? null}, name),
      priority = COALESCE(${input.priority ?? null}, priority),
      work_status = COALESCE(${input.workStatus ?? null}, work_status),
      start_date = COALESCE(${input.startDate ?? null}::date, start_date),
      expected_end_date = CASE WHEN ${input.expectedEndDate !== undefined} THEN ${input.expectedEndDate ?? null}::date ELSE expected_end_date END,
      budget = CASE WHEN ${input.budget !== undefined} THEN ${input.budget ?? null}::numeric ELSE budget END,
      description = CASE WHEN ${input.description !== undefined} THEN ${input.description ?? null} ELSE description END,
      remarks = CASE WHEN ${input.remarks !== undefined} THEN ${input.remarks ?? null} ELSE remarks END,
      updated_at = now()
    WHERE organization_id = ${organizationId} AND id = ${id}
  `);
}

export async function archiveProjectRow(tx: Tx, organizationId: string, id: string): Promise<void> {
  await tx.query(sql`UPDATE project SET archived_at = now() WHERE organization_id = ${organizationId} AND id = ${id}`);
}

export async function findProjectClientId(ctx: RequestContext, id: string): Promise<string | null> {
  const row = await db.maybeOne<{ clientId: string }>(ctx, sql`SELECT client_id AS "clientId" FROM project WHERE organization_id = ${ctx.organizationId} AND id = ${id}`);
  return row?.clientId ?? null;
}
