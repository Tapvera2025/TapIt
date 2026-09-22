import type { Resource } from '@tapcrm/authz';
import { visibilityFilter } from '@tapcrm/authz';
import type { RequestContext } from '../../platform/dal/context.js';
import { db } from '../../platform/dal/db.js';
import {
  TASK_ERROR_CODES,
  TaskNotFoundError,
  TaskValidationError,
} from './errors.js';
import {
  enqueueTaskAudit,
  findTaskById,
  findTaskByIdTx,
  insertTaskAssignees,
  insertTaskRow,
  listTasksWithFilter,
  replaceTaskAssignees,
  updateTaskRow,
  validateAssigneeIds,
} from './repository.js';
import type { PaginatedTasks, Task, TaskStatus } from './types.js';
import type {
  AssignTaskInput,
  CreateTaskInput,
  TaskListQueryInput,
  TransitionTaskInput,
  UpdateTaskInput,
} from './validators.js';

/**
 * Task lifecycle state machine.
 *
 * Enforces explicit legal transitions:
 * - pending     -> in_progress, completed, cancelled
 * - in_progress -> completed, pending, cancelled
 * - completed   -> in_progress, pending (re-opening)
 * - cancelled   -> pending, in_progress (re-opening)
 */
const VALID_TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  pending: ['in_progress', 'completed', 'cancelled'],
  in_progress: ['completed', 'pending', 'cancelled'],
  completed: ['in_progress', 'pending'],
  cancelled: ['pending', 'in_progress'],
};

export function assertValidTransition(
  current: TaskStatus,
  target: TaskStatus,
): void {
  if (current === target) return;
  const allowed = VALID_TRANSITIONS[current] ?? [];
  if (!allowed.includes(target)) {
    throw new TaskValidationError(
      TASK_ERROR_CODES.TASK_INVALID_TRANSITION,
      `Cannot transition task status: ${current} -> ${target}`,
      { current, target, allowed },
    );
  }
}

export async function loadTaskResource(
  ctx: RequestContext,
  id: string,
): Promise<Resource | null> {
  const task = await findTaskById(ctx, id);
  if (!task) return null;
  return {
    type: 'task',
    id: task.id,
    organizationId: task.organizationId,
    createdBy: task.createdBy,
    assignedTo: task.assignees[0]?.id ?? null,
    assigneeIds: task.assignees.map((a) => a.id),
    status: task.status,
    priority: task.priority,
  };
}

export async function createTask(
  ctx: RequestContext,
  input: CreateTaskInput,
): Promise<Task> {
  const uniqueAssigneeIds = [...new Set(input.assigneeIds ?? [])];

  return db.transaction(ctx, async (tx) => {
    if (uniqueAssigneeIds.length > 0) {
      const validIds = await validateAssigneeIds(
        tx,
        ctx.organizationId,
        uniqueAssigneeIds,
      );
      if (validIds.length !== uniqueAssigneeIds.length) {
        const missing = uniqueAssigneeIds.filter((id) => !validIds.includes(id));
        throw new TaskValidationError(
          TASK_ERROR_CODES.TASK_ASSIGNEE_NOT_FOUND,
          'One or more assignees do not exist or do not belong to this organization',
          { missingAssigneeIds: missing },
        );
      }
    }

    const { id } = await insertTaskRow(tx, {
      organizationId: ctx.organizationId,
      title: input.title,
      description: input.description ?? null,
      projectId: input.projectId ?? null,
      priority: input.priority,
      status: 'pending',
      dueDate: input.dueDate ?? null,
      createdBy: ctx.principal.id,
    });

    if (uniqueAssigneeIds.length > 0) {
      await insertTaskAssignees(
        tx,
        ctx.organizationId,
        id,
        uniqueAssigneeIds,
        ctx.principal.id,
      );
    }

    await enqueueTaskAudit(tx, ctx, {
      action: 'task.created',
      targetId: id,
      after: {
        title: input.title,
        priority: input.priority,
        status: 'pending',
        assigneeIds: uniqueAssigneeIds,
        dueDate: input.dueDate ?? null,
      },
    });

    const created = await findTaskByIdTx(tx, ctx.organizationId, id);
    if (!created) {
      throw new Error('Failed to load task immediately after creation');
    }

    return created;
  });
}

export async function getTask(
  ctx: RequestContext,
  id: string,
): Promise<Task> {
  const task = await findTaskById(ctx, id);
  if (!task) {
    throw new TaskNotFoundError();
  }
  return task;
}

export async function listTasks(
  ctx: RequestContext,
  query: TaskListQueryInput,
): Promise<PaginatedTasks> {
  const filter = await visibilityFilter(ctx, 'tasks:view', 'task');

  const { items, total } = await listTasksWithFilter(ctx, query, filter);
  const pageSize = query.pageSize ?? 20;
  const page = query.page ?? 1;
  const totalPages = Math.ceil(total / pageSize) || 1;

  return {
    items,
    total,
    page,
    pageSize,
    totalPages,
  };
}

export async function updateTask(
  ctx: RequestContext,
  id: string,
  input: UpdateTaskInput,
): Promise<Task> {
  const existing = await findTaskById(ctx, id);
  if (!existing) {
    throw new TaskNotFoundError();
  }

  return db.transaction(ctx, async (tx) => {
    await updateTaskRow(tx, ctx.organizationId, id, {
      title: input.title,
      description: input.description,
      projectId: input.projectId,
      priority: input.priority,
      dueDate: input.dueDate,
    });

    await enqueueTaskAudit(tx, ctx, {
      action: 'task.updated',
      targetId: id,
      before: {
        title: existing.title,
        description: existing.description,
        priority: existing.priority,
        dueDate: existing.dueDate,
      },
      after: {
        title: input.title ?? existing.title,
        description:
          input.description !== undefined
            ? input.description
            : existing.description,
        priority: input.priority ?? existing.priority,
        dueDate: input.dueDate !== undefined ? input.dueDate : existing.dueDate,
      },
    });

    const updated = await findTaskByIdTx(tx, ctx.organizationId, id);
    if (!updated) {
      throw new TaskNotFoundError();
    }
    return updated;
  });
}

export async function transitionTask(
  ctx: RequestContext,
  id: string,
  input: TransitionTaskInput,
): Promise<Task> {
  const existing = await findTaskById(ctx, id);
  if (!existing) {
    throw new TaskNotFoundError();
  }

  assertValidTransition(existing.status, input.status);

  return db.transaction(ctx, async (tx) => {
    await updateTaskRow(tx, ctx.organizationId, id, {
      status: input.status,
    });

    const action =
      input.status === 'completed' ? 'task.completed' : 'task.status_changed';

    await enqueueTaskAudit(tx, ctx, {
      action,
      targetId: id,
      before: { status: existing.status },
      after: { status: input.status, notes: input.notes ?? null },
    });

    const updated = await findTaskByIdTx(tx, ctx.organizationId, id);
    if (!updated) {
      throw new TaskNotFoundError();
    }
    return updated;
  });
}

export async function assignTask(
  ctx: RequestContext,
  id: string,
  input: AssignTaskInput,
): Promise<Task> {
  const existing = await findTaskById(ctx, id);
  if (!existing) {
    throw new TaskNotFoundError();
  }

  const uniqueAssigneeIds = [...new Set(input.assigneeIds)];

  return db.transaction(ctx, async (tx) => {
    if (uniqueAssigneeIds.length > 0) {
      const validIds = await validateAssigneeIds(
        tx,
        ctx.organizationId,
        uniqueAssigneeIds,
      );
      if (validIds.length !== uniqueAssigneeIds.length) {
        const missing = uniqueAssigneeIds.filter((mId) => !validIds.includes(mId));
        throw new TaskValidationError(
          TASK_ERROR_CODES.TASK_ASSIGNEE_NOT_FOUND,
          'One or more assignees do not exist or do not belong to this organization',
          { missingAssigneeIds: missing },
        );
      }
    }

    await replaceTaskAssignees(
      tx,
      ctx.organizationId,
      id,
      uniqueAssigneeIds,
      ctx.principal.id,
    );

    await enqueueTaskAudit(tx, ctx, {
      action: 'task.assigned',
      targetId: id,
      before: { assigneeIds: existing.assignees.map((a) => a.id) },
      after: { assigneeIds: uniqueAssigneeIds },
    });

    const updated = await findTaskByIdTx(tx, ctx.organizationId, id);
    if (!updated) {
      throw new TaskNotFoundError();
    }
    return updated;
  });
}
