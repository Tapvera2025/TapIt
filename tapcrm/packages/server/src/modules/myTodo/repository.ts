import type { SqlFragment } from '@tapcrm/authz';
import type { RequestContext } from '../../platform/dal/context.js';
import { db } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import type {
  CreateTodoData,
  ListTodosFilters,
  MyTodoDbRow,
  UpdateTodoData,
} from './types.js';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Insert a new Todo record strictly scoped to the tenant and authenticated user.
 */
export async function createTodoRow(
  ctx: RequestContext,
  data: CreateTodoData,
): Promise<MyTodoDbRow> {
  const priority = data.priority ?? 'medium';
  const description = data.description ?? null;
  const scheduledDate = data.scheduledDate ?? null;
  const dueTime = data.dueTime ?? null;

  return db.one<MyTodoDbRow>(
    ctx,
    sql`
      INSERT INTO my_todo (
        organization_id,
        user_id,
        title,
        description,
        priority,
        scheduled_date,
        due_time,
        status,
        created_at,
        updated_at
      )
      VALUES (
        ${ctx.organizationId},
        ${ctx.principal.id},
        ${data.title},
        ${description},
        ${priority},
        ${scheduledDate ? sql`${scheduledDate}::date` : null},
        ${dueTime},
        'pending',
        now(),
        now()
      )
      RETURNING
        id,
        organization_id,
        user_id,
        title,
        description,
        priority,
        scheduled_date::text AS scheduled_date,
        due_time,
        status,
        completed_at,
        created_at,
        updated_at
    `,
  );
}

/**
 * Retrieve a specific Todo by ID scoped strictly to the current user and tenant.
 */
export async function findTodoRowById(
  ctx: RequestContext,
  id: string,
): Promise<MyTodoDbRow | null> {
  if (!UUID_REGEX.test(id)) return null;

  return db.maybeOne<MyTodoDbRow>(
    ctx,
    sql`
      SELECT
        id,
        organization_id,
        user_id,
        title,
        description,
        priority,
        scheduled_date::text AS scheduled_date,
        due_time,
        status,
        completed_at,
        created_at,
        updated_at,
        deleted_at
      FROM my_todo
      WHERE organization_id = ${ctx.organizationId}
        AND user_id = ${ctx.principal.id}
        AND id = ${id}
        AND deleted_at IS NULL
    `,
  );
}

/**
 * List Todos belonging to the authenticated user, optionally filtered.
 */
export async function listTodoRows(
  ctx: RequestContext,
  filters?: ListTodosFilters,
): Promise<MyTodoDbRow[]> {
  const whereClauses: SqlFragment[] = [
    sql`organization_id = ${ctx.organizationId}`,
    sql`user_id = ${ctx.principal.id}`,
    sql`deleted_at IS NULL`,
  ];

  if (filters?.status) {
    whereClauses.push(sql`status = ${filters.status}`);
  }

  if (filters?.scheduledDate) {
    whereClauses.push(sql`scheduled_date = ${filters.scheduledDate}::date`);
  }

  return db.query<MyTodoDbRow>(
    ctx,
    sql`
      SELECT
        id,
        organization_id,
        user_id,
        title,
        description,
        priority,
        scheduled_date::text AS scheduled_date,
        due_time,
        status,
        completed_at,
        created_at,
        updated_at,
        deleted_at
      FROM my_todo
      WHERE ${sql.join(whereClauses, ' AND ')}
      ORDER BY
        CASE WHEN status = 'pending' THEN 0 ELSE 1 END,
        scheduled_date ASC NULLS LAST,
        created_at DESC,
        id DESC
    `,
  );
}

/**
 * Update an existing Todo owned by the authenticated user.
 */
export async function updateTodoRow(
  ctx: RequestContext,
  id: string,
  data: UpdateTodoData,
): Promise<MyTodoDbRow | null> {
  if (!UUID_REGEX.test(id)) return null;

  const setClauses: SqlFragment[] = [sql`updated_at = now()`];

  if (data.title !== undefined) {
    setClauses.push(sql`title = ${data.title}`);
  }
  if (data.description !== undefined) {
    setClauses.push(sql`description = ${data.description}`);
  }
  if (data.priority !== undefined) {
    setClauses.push(sql`priority = ${data.priority}`);
  }
  if (data.scheduledDate !== undefined) {
    setClauses.push(
      data.scheduledDate === null
        ? sql`scheduled_date = NULL`
        : sql`scheduled_date = ${data.scheduledDate}::date`,
    );
  }
  if (data.dueTime !== undefined) {
    setClauses.push(sql`due_time = ${data.dueTime}`);
  }
  if (data.status !== undefined) {
    setClauses.push(sql`status = ${data.status}`);
    if (data.status === 'completed') {
      setClauses.push(sql`completed_at = now()`);
    } else if (data.status === 'pending') {
      setClauses.push(sql`completed_at = NULL`);
    }
  }

  return db.maybeOne<MyTodoDbRow>(
    ctx,
    sql`
      UPDATE my_todo
      SET ${sql.join(setClauses, ', ')}
      WHERE organization_id = ${ctx.organizationId}
        AND user_id = ${ctx.principal.id}
        AND id = ${id}
        AND deleted_at IS NULL
      RETURNING
        id,
        organization_id,
        user_id,
        title,
        description,
        priority,
        scheduled_date::text AS scheduled_date,
        due_time,
        status,
        completed_at,
        created_at,
        updated_at,
        deleted_at
    `,
  );
}

/**
 * Delete a specific Todo owned by the authenticated user via soft delete.
 */
export async function deleteTodoRow(
  ctx: RequestContext,
  id: string,
): Promise<boolean> {
  if (!UUID_REGEX.test(id)) return false;

  const result = await db.maybeOne<{ id: string }>(
    ctx,
    sql`
      UPDATE my_todo
      SET
        deleted_at = now(),
        updated_at = now()
      WHERE organization_id = ${ctx.organizationId}
        AND user_id = ${ctx.principal.id}
        AND id = ${id}
        AND deleted_at IS NULL
      RETURNING id
    `,
  );

  return result !== null;
}
