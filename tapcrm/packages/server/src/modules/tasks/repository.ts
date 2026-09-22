import type { SqlFragment } from '@tapcrm/authz';
import type { RequestContext } from '../../platform/dal/context.js';
import type { Tx } from '../../platform/dal/db.js';
import { db } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import type {
  Task,
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
  priority: TaskPriority;
  status: TaskStatus;
  dueDate: Date | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  assignees: Array<{
    id: string;
    email?: string;
    fullName: string;
    assignedAt: string | Date;
  }> | null;
}

function mapTaskRow(row: TaskDbRow): Task {
  return {
    id: row.id,
    organizationId: row.organizationId,
    title: row.title,
    description: row.description,
    projectId: row.projectId,
    priority: row.priority,
    status: row.status,
    dueDate: row.dueDate ? new Date(row.dueDate) : null,
    createdBy: row.createdBy,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
    assignees: (row.assignees ?? []).map((a) => ({
      id: a.id,
      email: a.email,
      fullName: a.fullName,
      assignedAt: new Date(a.assignedAt),
    })),
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
): Promise<void> {
  for (const userId of assigneeIds) {
    await tx.query(sql`
      INSERT INTO task_assignee (
        organization_id, task_id, user_id, assigned_by, assigned_at
      ) VALUES (
        ${organizationId}, ${taskId}, ${userId}, ${assignedBy}, now()
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
  await tx.query(sql`
    DELETE FROM task_assignee
    WHERE organization_id = ${organizationId} AND task_id = ${taskId}
  `);
  await insertTaskAssignees(tx, organizationId, taskId, assigneeIds, assignedBy);
}

const TASK_SELECT = sql`
  SELECT
    t.id,
    t.organization_id,
    t.title,
    t.description,
    t.project_id,
    t.priority,
    t.status,
    t.due_date,
    t.created_by,
    t.created_at,
    t.updated_at,
    COALESCE(
      (
        SELECT json_agg(json_build_object(
          'id', u.id,
          'email', u.email,
          'fullName', u.full_name,
          'assignedAt', ta.assigned_at
        ) ORDER BY ta.assigned_at ASC)
        FROM task_assignee ta
        JOIN app_user u ON u.id = ta.user_id AND u.organization_id = ta.organization_id
        WHERE ta.task_id = t.id AND ta.organization_id = t.organization_id
      ),
      '[]'::json
    ) AS assignees
  FROM task t
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
