import type { RequestContext } from '../../platform/dal/context.js';
import { NotFoundError } from '../../platform/http/error-handler.js';
import {
  createTodoRow,
  deleteTodoRow,
  findTodoRowById,
  listTodoRows,
  updateTodoRow,
} from './repository.js';
import type {
  CreateTodoData,
  ListTodosFilters,
  MyTodo,
  MyTodoDbRow,
  UpdateTodoData,
} from './types.js';

function formatScheduledDate(
  val: string | Date | null | undefined,
): string | null {
  if (!val) return null;
  if (val instanceof Date) {
    return val.toISOString().slice(0, 10);
  }
  return String(val).slice(0, 10);
}

function formatTimestamp(val: Date | string | null | undefined): string | null {
  if (!val) return null;
  if (val instanceof Date) {
    return val.toISOString();
  }
  return String(val);
}

function formatRequiredTimestamp(val: Date | string | undefined): string {
  if (!val) return new Date().toISOString();
  if (val instanceof Date) {
    return val.toISOString();
  }
  return String(val);
}

export function toTodoView(row: MyTodoDbRow): MyTodo {
  const organizationId = row.organizationId ?? row.organization_id ?? '';
  const userId = row.userId ?? row.user_id ?? '';
  const scheduledDate =
    row.scheduled_date === null || row.scheduledDate === null
      ? null
      : (row.scheduledDate ?? row.scheduled_date ?? null);
  const dueTime =
    row.due_time === null || row.dueTime === null
      ? null
      : (row.dueTime ?? row.due_time ?? null);
  const completedAt =
    row.completed_at === null || row.completedAt === null
      ? null
      : (row.completedAt ?? row.completed_at ?? null);
  const createdAt = row.createdAt ?? row.created_at;
  const updatedAt = row.updatedAt ?? row.updated_at;

  return {
    id: row.id,
    organizationId,
    userId,
    title: row.title,
    description: row.description,
    priority: row.priority,
    scheduledDate: formatScheduledDate(scheduledDate),
    dueTime,
    status: row.status,
    completedAt: formatTimestamp(completedAt),
    createdAt: formatRequiredTimestamp(createdAt),
    updatedAt: formatRequiredTimestamp(updatedAt),
  };
}

/**
 * Retrieve all Todos belonging to the authenticated user.
 */
export async function listTodos(
  ctx: RequestContext,
  filters?: ListTodosFilters,
): Promise<MyTodo[]> {
  const rows = await listTodoRows(ctx, filters);
  return rows.map(toTodoView);
}

/**
 * Retrieve a specific Todo by ID.
 * Throws NotFoundError if not found or belongs to another user/tenant.
 */
export async function getTodoById(
  ctx: RequestContext,
  id: string,
): Promise<MyTodo> {
  const row = await findTodoRowById(ctx, id);
  if (!row) {
    throw new NotFoundError('Todo');
  }
  return toTodoView(row);
}

/**
 * Create a new personal Todo for the authenticated user.
 */
export async function createTodo(
  ctx: RequestContext,
  input: CreateTodoData,
): Promise<MyTodo> {
  const row = await createTodoRow(ctx, input);
  return toTodoView(row);
}

/**
 * Update an existing Todo owned by the authenticated user.
 * Throws NotFoundError if not found or belongs to another user/tenant.
 */
export async function updateTodo(
  ctx: RequestContext,
  id: string,
  input: UpdateTodoData,
): Promise<MyTodo> {
  const row = await updateTodoRow(ctx, id, input);
  if (!row) {
    throw new NotFoundError('Todo');
  }
  return toTodoView(row);
}

/**
 * Delete a specific Todo owned by the authenticated user.
 * Throws NotFoundError if not found or belongs to another user/tenant.
 */
export async function deleteTodo(
  ctx: RequestContext,
  id: string,
): Promise<{ success: true }> {
  const deleted = await deleteTodoRow(ctx, id);
  if (!deleted) {
    throw new NotFoundError('Todo');
  }
  return { success: true };
}

/**
 * Mark a Todo as completed.
 */
export async function completeTodo(
  ctx: RequestContext,
  id: string,
): Promise<MyTodo> {
  return updateTodo(ctx, id, { status: 'completed' });
}

/**
 * Reopen a completed Todo back to pending.
 */
export async function reopenTodo(
  ctx: RequestContext,
  id: string,
): Promise<MyTodo> {
  return updateTodo(ctx, id, { status: 'pending' });
}
