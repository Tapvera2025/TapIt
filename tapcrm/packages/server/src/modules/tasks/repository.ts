import type { SqlFragment } from '@tapcrm/authz';
import type { RequestContext } from '../../platform/dal/context.js';
import type { Tx } from '../../platform/dal/db.js';
import { db } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import type {
  Task,
  TaskAssignableUser,
  TaskAssigneesQuery,
  TaskListQuery,
  TaskPriority,
  TaskStatus,
} from './types.js';

interface TaskDbRow {
  id: string;
  organizationId: string;
  title: string;
  description: string | null;
  projectId: string | null;
  projectName?: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  dueDate: Date | null;
  createdBy: string;
  createdByName?: string | null;
  creatorTeamId?: string | null;
  creatorDepartmentId?: string | null;
  createdAt: Date;
  updatedAt: Date;
  assignees: Array<{
    id: string;
    email?: string;
    fullName: string;
    teamId?: string | null;
    departmentId?: string | null;
    assignedAt: string | Date;
    status?: string | null;
  }> | null;
}

function mapTaskRow(row: TaskDbRow): Task {
  const assignees = (row.assignees ?? []).map((a) => ({
    id: a.id,
    email: a.email,
    fullName: a.fullName,
    teamId: a.teamId ?? null,
    departmentId: a.departmentId ?? null,
    assignedAt: new Date(a.assignedAt),
    status: (a.status as TaskStatus) ?? 'pending',
  }));
  const assigneeTeamIds = assignees
    .map((a) => a.teamId)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
  const allTeamIds = Array.from(
    new Set([
      ...(row.creatorTeamId ? [row.creatorTeamId] : []),
      ...assigneeTeamIds,
    ]),
  );
  const assigneeDepartmentIds = assignees
    .map((a) => a.departmentId)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
  const allDepartmentIds = Array.from(
    new Set([
      ...(row.creatorDepartmentId ? [row.creatorDepartmentId] : []),
      ...assigneeDepartmentIds,
    ]),
  );

  return {
    id: row.id,
    organizationId: row.organizationId,
    title: row.title,
    description: row.description,
    projectId: row.projectId,
    projectName: row.projectName ?? null,
    priority: row.priority,
    status: row.status,
    dueDate: row.dueDate ? new Date(row.dueDate) : null,
    createdBy: row.createdBy,
    createdByName: row.createdByName ?? null,
    creatorTeamId: row.creatorTeamId ?? null,
    creatorDepartmentId: row.creatorDepartmentId ?? null,
    departmentId: row.creatorDepartmentId ?? assigneeDepartmentIds[0] ?? null,
    departmentIds: allDepartmentIds,
    teamId: row.creatorTeamId ?? assigneeTeamIds[0] ?? null,
    teamIds: allTeamIds,
    poolId: row.creatorTeamId ?? assigneeTeamIds[0] ?? null,
    poolIds: allTeamIds,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
    assignees,
  };
}

export async function validateAssigneeIds(
  tx: Tx,
  organizationId: string,
  assigneeIds: readonly string[],
): Promise<string[]> {
  if (assigneeIds.length === 0) return [];
  const rows = await tx.query<{ id: string }>(sql`
    SELECT id FROM app_user
    WHERE organization_id = ${organizationId}
      AND id = ANY(${assigneeIds}::uuid[])
      AND status = 'active'
  `);
  return rows.map((r) => r.id);
}

export async function validateAssigneesInTeamScope(
  tx: Tx,
  organizationId: string,
  assigneeIds: readonly string[],
  allowedTeamIds: ReadonlySet<string>,
  principalId: string,
): Promise<string[]> {
  if (assigneeIds.length === 0) return [];
  const teamIdArray = [...allowedTeamIds];
  if (teamIdArray.length === 0) {
    return assigneeIds.filter((id) => id === principalId);
  }
  const rows = await tx.query<{ id: string }>(sql`
    SELECT id FROM app_user
    WHERE organization_id = ${organizationId}
      AND id = ANY(${assigneeIds}::uuid[])
      AND status = 'active'
      AND (team_id = ANY(${teamIdArray}::uuid[]) OR id = ${principalId})
  `);
  return rows.map((r) => r.id);
}

export async function validateAssigneesInDepartmentScope(
  tx: Tx,
  organizationId: string,
  assigneeIds: readonly string[],
  departmentId: string | null,
  principalId: string,
): Promise<string[]> {
  if (assigneeIds.length === 0) return [];
  if (departmentId === null) {
    return assigneeIds.filter((id) => id === principalId);
  }
  const rows = await tx.query<{ id: string }>(sql`
    SELECT id FROM app_user
    WHERE organization_id = ${organizationId}
      AND id = ANY(${assigneeIds}::uuid[])
      AND status = 'active'
      AND (department_id = ${departmentId} OR id = ${principalId})
  `);
  return rows.map((r) => r.id);
}

export async function validateAssigneesInPoolScope(
  tx: Tx,
  organizationId: string,
  assigneeIds: readonly string[],
  allowedPoolMemberIds: ReadonlySet<string>,
  allowedPoolIds: ReadonlySet<string>,
  principalId: string,
): Promise<string[]> {
  if (assigneeIds.length === 0) return [];
  const memberArray = [...allowedPoolMemberIds];
  const poolArray = [...allowedPoolIds];
  if (memberArray.length === 0 && poolArray.length === 0) {
    return assigneeIds.filter((id) => id === principalId);
  }

  if (memberArray.length > 0 && poolArray.length > 0) {
    const rows = await tx.query<{ id: string }>(sql`
      SELECT id FROM app_user
      WHERE organization_id = ${organizationId}
        AND id = ANY(${assigneeIds}::uuid[])
        AND status = 'active'
        AND (id = ANY(${memberArray}::uuid[]) OR team_id = ANY(${poolArray}::uuid[]) OR id = ${principalId})
    `);
    return rows.map((r) => r.id);
  }

  if (memberArray.length > 0) {
    const rows = await tx.query<{ id: string }>(sql`
      SELECT id FROM app_user
      WHERE organization_id = ${organizationId}
        AND id = ANY(${assigneeIds}::uuid[])
        AND status = 'active'
        AND (id = ANY(${memberArray}::uuid[]) OR id = ${principalId})
    `);
    return rows.map((r) => r.id);
  }

  const rows = await tx.query<{ id: string }>(sql`
    SELECT id FROM app_user
    WHERE organization_id = ${organizationId}
      AND id = ANY(${assigneeIds}::uuid[])
      AND status = 'active'
      AND (team_id = ANY(${poolArray}::uuid[]) OR id = ${principalId})
  `);
  return rows.map((r) => r.id);
}


export async function insertTaskRow(
  tx: Tx,
  input: {
    organizationId: string;
    title: string;
    description: string | null;
    projectId: string | null;
    priority: TaskPriority;
    status: TaskStatus;
    dueDate: Date | null;
    createdBy: string;
  },
): Promise<{ id: string }> {
  return tx.one<{ id: string }>(sql`
    INSERT INTO task (
      organization_id, title, description, project_id, priority, status, due_date, created_by
    ) VALUES (
      ${input.organizationId}, ${input.title}, ${input.description}, ${input.projectId},
      ${input.priority}, ${input.status}, ${input.dueDate}, ${input.createdBy}
    )
    RETURNING id
  `);
}

export async function insertTaskAssignees(
  tx: Tx,
  organizationId: string,
  taskId: string,
  assigneeIds: readonly string[],
  assignedBy: string,
  initialStatus: TaskStatus = 'pending',
): Promise<void> {
  for (const userId of assigneeIds) {
    await tx.query(sql`
      INSERT INTO task_assignee (
        organization_id, task_id, user_id, assigned_by, assigned_at, status
      ) VALUES (
        ${organizationId}, ${taskId}, ${userId}, ${assignedBy}, now(), ${initialStatus}
      )
      ON CONFLICT (organization_id, task_id, user_id) DO NOTHING
    `);
  }
}

export async function replaceTaskAssignees(
  tx: Tx,
  organizationId: string,
  taskId: string,
  assigneeIds: readonly string[],
  assignedBy: string,
): Promise<void> {
  if (assigneeIds.length === 0) {
    await tx.query(sql`
      DELETE FROM task_assignee
      WHERE organization_id = ${organizationId} AND task_id = ${taskId}
    `);
    return;
  }
  await tx.query(sql`
    DELETE FROM task_assignee
    WHERE organization_id = ${organizationId} AND task_id = ${taskId}
      AND NOT (user_id = ANY(${assigneeIds}::uuid[]))
  `);
  await insertTaskAssignees(tx, organizationId, taskId, assigneeIds, assignedBy);
}

export async function updateTaskAssigneeStatus(
  tx: Tx,
  organizationId: string,
  taskId: string,
  userId: string,
  status: TaskStatus,
): Promise<boolean> {
  const rows = await tx.query<{ userId: string }>(sql`
    UPDATE task_assignee
    SET status = ${status}
    WHERE organization_id = ${organizationId}
      AND task_id = ${taskId}
      AND user_id = ${userId}
    RETURNING user_id AS "userId"
  `);
  return rows.length > 0;
}

const TASK_SELECT = sql`
  SELECT
    t.id,
    t.organization_id,
    t.title,
    t.description,
    t.project_id,
    project.name AS "projectName",
    t.priority,
    t.status,
    t.due_date,
    t.created_by,
    creator.full_name AS "createdByName",
    creator.team_id AS "creatorTeamId",
    creator.department_id AS "creatorDepartmentId",
    t.created_at,
    t.updated_at,
    COALESCE(
      (
        SELECT json_agg(json_build_object(
          'id', u.id,
          'email', u.email,
          'fullName', u.full_name,
          'teamId', u.team_id,
          'departmentId', u.department_id,
          'assignedAt', ta.assigned_at,
          'status', ta.status
        ) ORDER BY ta.assigned_at ASC)
        FROM task_assignee ta
        JOIN app_user u ON u.id = ta.user_id AND u.organization_id = ta.organization_id
        WHERE ta.task_id = t.id AND ta.organization_id = t.organization_id
      ),
      '[]'::json
    ) AS assignees
  FROM task t
  LEFT JOIN app_user creator ON creator.id = t.created_by AND creator.organization_id = t.organization_id
  LEFT JOIN project ON project.id = t.project_id AND project.organization_id = t.organization_id
`;

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function findTaskById(
  ctx: RequestContext,
  id: string,
): Promise<Task | null> {
  if (!UUID_REGEX.test(id)) return null;
  const row = await db.maybeOne<TaskDbRow>(
    ctx,
    sql`
      ${TASK_SELECT}
      WHERE t.organization_id = ${ctx.organizationId} AND t.id = ${id}
    `,
  );
  return row ? mapTaskRow(row) : null;
}

export async function findTaskByIdTx(
  tx: Tx,
  organizationId: string,
  id: string,
): Promise<Task | null> {
  if (!UUID_REGEX.test(id)) return null;
  const row = await tx.maybeOne<TaskDbRow>(sql`
    ${TASK_SELECT}
    WHERE t.organization_id = ${organizationId} AND t.id = ${id}
  `);
  return row ? mapTaskRow(row) : null;
}

export async function updateTaskRow(
  tx: Tx,
  organizationId: string,
  id: string,
  updates: {
    title?: string | undefined;
    description?: string | null | undefined;
    projectId?: string | null | undefined;
    priority?: TaskPriority | undefined;
    status?: TaskStatus | undefined;
    dueDate?: Date | null | undefined;
  },
): Promise<void> {
  const setClauses: SqlFragment[] = [];

  if (updates.title !== undefined) {
    setClauses.push(sql`title = ${updates.title}`);
  }
  if (updates.description !== undefined) {
    setClauses.push(sql`description = ${updates.description}`);
  }
  if (updates.projectId !== undefined) {
    setClauses.push(sql`project_id = ${updates.projectId}`);
  }
  if (updates.priority !== undefined) {
    setClauses.push(sql`priority = ${updates.priority}`);
  }
  if (updates.status !== undefined) {
    setClauses.push(sql`status = ${updates.status}`);
  }
  if (updates.dueDate !== undefined) {
    setClauses.push(sql`due_date = ${updates.dueDate}`);
  }

  if (setClauses.length === 0) return;

  await tx.query(sql`
    UPDATE task
    SET ${sql.join(setClauses, ', ')}
    WHERE organization_id = ${organizationId} AND id = ${id}
  `);
}

export async function listTasksWithFilter(
  ctx: RequestContext,
  query: TaskListQuery,
  authzFilter?: SqlFragment,
): Promise<{ items: readonly Task[]; total: number }> {
  const whereClauses: SqlFragment[] = [
    sql`t.organization_id = ${ctx.organizationId}`,
  ];

  if (authzFilter && authzFilter.sql !== 'TRUE') {
    whereClauses.push(sql`(${authzFilter})`);
  }

  // Preset 1: Status & Priority
  if (query.status && query.status !== 'all') {
    whereClauses.push(sql`t.status = ${query.status}`);
  }
  if (query.priority && query.priority !== 'all') {
    whereClauses.push(sql`t.priority = ${query.priority}`);
  }

  // Preset 2: Date presets
  if (query.datePreset) {
    switch (query.datePreset) {
      case 'today':
        whereClauses.push(
          sql`t.due_date >= CURRENT_DATE AND t.due_date < CURRENT_DATE + INTERVAL '1 day'`,
        );
        break;
      case 'this_month':
        whereClauses.push(
          sql`t.due_date >= date_trunc('month', CURRENT_DATE) AND t.due_date < date_trunc('month', CURRENT_DATE) + INTERVAL '1 month'`,
        );
        break;
      case 'overdue':
        whereClauses.push(
          sql`t.due_date < now() AND t.status NOT IN ('completed', 'cancelled')`,
        );
        break;
      case 'custom':
        if (query.startDate) {
          whereClauses.push(sql`t.due_date >= ${query.startDate}`);
        }
        if (query.endDate) {
          whereClauses.push(sql`t.due_date <= ${query.endDate}`);
        }
        break;
      case 'all':
      default:
        break;
    }
  }

  // Search filter
  if (query.search) {
    const pattern = `%${query.search}%`;
    whereClauses.push(
      sql`(t.title ILIKE ${pattern} OR t.description ILIKE ${pattern})`,
    );
  }

  // Project filter
  if (query.projectId) {
    whereClauses.push(sql`t.project_id = ${query.projectId}`);
  }

  // Assignee filter
  if (query.assigneeId) {
    whereClauses.push(sql`EXISTS (
      SELECT 1 FROM task_assignee ta
      WHERE ta.task_id = t.id AND ta.user_id = ${query.assigneeId} AND ta.organization_id = ${ctx.organizationId}
    )`);
  }

  // Creator filter
  if (query.creatorId) {
    whereClauses.push(sql`t.created_by = ${query.creatorId}`);
  }

  // Participant filter (user is creator OR user is an eligible assignee/participant)
  if (query.participantId) {
    whereClauses.push(sql`(
      t.created_by = ${query.participantId} OR EXISTS (
        SELECT 1 FROM task_assignee ta
        WHERE ta.task_id = t.id AND ta.user_id = ${query.participantId} AND ta.organization_id = ${ctx.organizationId}
      )
    )`);
  }

  const whereCombined = sql.join(whereClauses, ' AND ');

  // Count total matching tasks
  const countRow = await db.one<{ count: string }>(
    ctx,
    sql`SELECT count(*)::text AS count FROM task t WHERE ${whereCombined}`,
  );
  const total = Number(countRow.count);

  // Sorting
  const SORT_FIELDS: Record<string, string> = {
    dueDate: 't.due_date',
    createdAt: 't.created_at',
    title: 't.title',
    priority: 't.priority',
    status: 't.status',
  };
  const sortCol = SORT_FIELDS[query.sortBy ?? 'dueDate'] ?? 't.due_date';
  const sortOrder = query.sortOrder === 'desc' ? 'DESC' : 'ASC';
  const nullsOrdering =
    sortCol === 't.due_date'
      ? sortOrder === 'ASC'
        ? 'NULLS LAST'
        : 'NULLS FIRST'
      : '';

  const orderClause = sql.raw(
    `ORDER BY ${sortCol} ${sortOrder} ${nullsOrdering}, t.created_at DESC`,
  );

  // Pagination
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 20;
  const offset = (page - 1) * pageSize;

  const rows = await db.query<TaskDbRow>(
    ctx,
    sql`
      ${TASK_SELECT}
      WHERE ${whereCombined}
      ${orderClause}
      LIMIT ${pageSize} OFFSET ${offset}
    `,
  );

  return {
    items: rows.map(mapTaskRow),
    total,
  };
}

export async function enqueueTaskAudit(
  tx: Tx,
  ctx: RequestContext,
  input: {
    action: string;
    targetId: string;
    before?: unknown;
    after?: unknown;
  },
): Promise<void> {
  await tx.query(sql`
    INSERT INTO audit_outbox (organization_id, stream, payload)
    VALUES (
      ${ctx.organizationId}, 'activity',
      ${JSON.stringify({
        action: input.action,
        actorId: ctx.principal.id,
        actorType: ctx.principal.accountType,
        targetType: 'task',
        targetId: input.targetId,
        before: input.before ?? null,
        after: input.after ?? null,
        requestId: ctx.requestId,
        sourceIp: ctx.sourceIp,
      })}::jsonb
    )
  `);
}

export interface AssignableUsersScope {
  readonly kind: 'all' | 'department' | 'team' | 'pool' | 'own' | 'none';
  readonly departmentId?: string | null;
  readonly teamIds?: readonly string[];
  readonly poolMemberIds?: readonly string[];
  readonly isProjectManager?: boolean;
}

export async function isPrincipalProjectManager(
  ctx: RequestContext,
): Promise<boolean> {
  if (ctx.principal.accountType !== 'employee' || !ctx.principal.positionId) {
    return false;
  }
  const row = await db.maybeOne<{ code: string; deptCode: string | null }>(
    ctx,
    sql`
      SELECT pos.code, d.code AS "deptCode"
      FROM position pos
      LEFT JOIN department d ON d.organization_id = pos.organization_id AND d.id = pos.department_id
      WHERE pos.organization_id = ${ctx.organizationId} AND pos.id = ${ctx.principal.positionId}
    `,
  );
  return row?.code === 'project-manager' || row?.deptCode === 'projects';
}

export async function findAssignableUsers(
  ctx: RequestContext,
  scope: AssignableUsersScope,
  query: TaskAssigneesQuery,
): Promise<readonly TaskAssignableUser[]> {
  if (scope.kind === 'none') {
    return [];
  }

  const whereClauses: SqlFragment[] = [
    sql`u.organization_id = ${ctx.organizationId}`,
    sql`u.status = 'active'`,
    sql`u.account_type IN ('employee', 'super-admin')`,
  ];

  if (scope.kind === 'department') {
    if (!scope.departmentId) return [];
    whereClauses.push(
      sql`(u.department_id = ${scope.departmentId} OR u.id = ${ctx.principal.id})`,
    );
  } else if (scope.kind === 'team') {
    if (!scope.teamIds || scope.teamIds.length === 0) return [];
    whereClauses.push(
      sql`(u.team_id = ANY(${scope.teamIds}::uuid[]) OR u.id = ${ctx.principal.id})`,
    );
  } else if (scope.kind === 'pool') {
    if (!scope.poolMemberIds || scope.poolMemberIds.length === 0) return [];
    whereClauses.push(sql`u.id = ANY(${scope.poolMemberIds}::uuid[])`);
  } else if (scope.kind === 'own') {
    if (scope.isProjectManager) {
      // PRD §3.7.1 PA-1 & TK-8: Project Manager directs delivery across development sub-teams
      whereClauses.push(sql`(d.code = 'development' OR u.id = ${ctx.principal.id})`);
    } else if (scope.departmentId) {
      // Regular IC / Base Employee: can assign to department peers/collaborators + self
      whereClauses.push(
        sql`(u.department_id = ${scope.departmentId} OR u.id = ${ctx.principal.id})`,
      );
    } else {
      // Fallback: own user record
      whereClauses.push(sql`u.id = ${ctx.principal.id}`);
    }
  }

  // Creating a task from inside a project restricts candidates to that
  // project's own team — narrower than whatever the caller's broader
  // department/team scope would otherwise allow, never wider.
  if (query.projectId) {
    whereClauses.push(sql`EXISTS (
      SELECT 1 FROM project_assignee pa
      WHERE pa.organization_id = u.organization_id AND pa.project_id = ${query.projectId} AND pa.user_id = u.id
    )`);
  }

  if (query.search?.trim()) {
    const pattern = `%${query.search.trim()}%`;
    whereClauses.push(sql`(u.full_name ILIKE ${pattern} OR u.email ILIKE ${pattern})`);
  }

  const rows = await db.query<{
    id: string;
    fullName: string;
    email: string | null;
    departmentName: string | null;
    positionName: string | null;
  }>(
    ctx,
    sql`
      SELECT
        u.id,
        u.full_name AS "fullName",
        u.email,
        d.name AS "departmentName",
        pos.name AS "positionName"
      FROM app_user u
      LEFT JOIN department d ON d.organization_id = u.organization_id AND d.id = u.department_id
      LEFT JOIN position pos ON pos.organization_id = u.organization_id AND pos.id = u.position_id
      WHERE ${sql.join(whereClauses, ' AND ')}
      ORDER BY u.full_name ASC
      LIMIT 100
    `,
  );

  return rows.map((r) => ({
    id: r.id,
    fullName: r.fullName,
    email: r.email ?? null,
    departmentName: r.departmentName ?? null,
    positionName: r.positionName ?? null,
  }));
}

