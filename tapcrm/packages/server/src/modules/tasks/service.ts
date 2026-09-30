import type { Resource } from '@tapcrm/authz';
import { AuthorizationError, effectivePolicy, visibilityFilter } from '@tapcrm/authz';
import { globalAccess } from '@tapcrm/contracts';
import { scopeResolver } from '../../platform/authz-adapter.js';
import type { RequestContext } from '../../platform/dal/context.js';
import { db } from '../../platform/dal/db.js';
import {
  TASK_ERROR_CODES,
  TaskNotFoundError,
  TaskValidationError,
} from './errors.js';
import {
  enqueueTaskAudit,
  findAssignableUsers,
  findTaskById,
  findTaskByIdTx,
  insertTaskAssignees,
  insertTaskRow,
  isPrincipalProjectManager,
  listTasksWithFilter,
  replaceTaskAssignees,
  updateTaskAssigneeStatus,
  updateTaskRow,
  validateAssigneeIds,
  validateAssigneesInDepartmentScope,
  validateAssigneesInPoolScope,
  validateAssigneesInTeamScope,
} from './repository.js';
import type {
  PaginatedTasks,
  Task,
  TaskAssignableUser,
  TaskStatus,
} from './types.js';
import type {
  AssignTaskInput,
  CreateTaskInput,
  TaskAssigneesQueryInput,
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
  const assigneeTeamIds = task.assignees
    .map((a) => a.teamId)
    .filter((tid): tid is string => typeof tid === 'string' && tid.length > 0);
  const teamIds = Array.from(
    new Set([
      ...(task.creatorTeamId ? [task.creatorTeamId] : []),
      ...assigneeTeamIds,
    ]),
  );
  const assigneeDepartmentIds = task.assignees
    .map((a) => a.departmentId)
    .filter((did): did is string => typeof did === 'string' && did.length > 0);
  const departmentIds = Array.from(
    new Set([
      ...(task.creatorDepartmentId ? [task.creatorDepartmentId] : []),
      ...assigneeDepartmentIds,
    ]),
  );
  return {
    type: 'task',
    id: task.id,
    organizationId: task.organizationId,
    createdBy: task.createdBy,
    assignedTo: task.assignees[0]?.id ?? null,
    assigneeIds: task.assignees.map((a) => a.id),
    status: task.status,
    priority: task.priority,
    creatorTeamId: task.creatorTeamId ?? null,
    creatorDepartmentId: task.creatorDepartmentId ?? null,
    assigneeTeamIds,
    assigneeDepartmentIds,
    departmentId: task.creatorDepartmentId ?? assigneeDepartmentIds[0] ?? null,
    departmentIds,
    teamId: task.creatorTeamId ?? assigneeTeamIds[0] ?? null,
    teamIds,
    poolId: task.creatorTeamId ?? assigneeTeamIds[0] ?? null,
    poolIds: teamIds,
    assignees: task.assignees,
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

      if (!globalAccess(ctx.principal)) {
        const assignPolicy = await effectivePolicy(ctx, 'tasks:assign');
        if (assignPolicy && assignPolicy.scope === 'team') {
          const allowedTeams = await scopeResolver.teamIds(ctx);
          const validScopedIds = await validateAssigneesInTeamScope(
            tx,
            ctx.organizationId,
            uniqueAssigneeIds,
            allowedTeams,
            ctx.principal.id,
          );
          if (validScopedIds.length !== uniqueAssigneeIds.length) {
            const outOfScope = uniqueAssigneeIds.filter((id) => !validScopedIds.includes(id));
            throw new TaskValidationError(
              TASK_ERROR_CODES.TASK_ASSIGNEE_NOT_FOUND,
              'One or more assignees are outside your team scope',
              { missingAssigneeIds: outOfScope },
            );
          }
        } else if (assignPolicy && assignPolicy.scope === 'department') {
          const departmentId = await scopeResolver.departmentId(ctx);
          const validScopedIds = await validateAssigneesInDepartmentScope(
            tx,
            ctx.organizationId,
            uniqueAssigneeIds,
            departmentId,
            ctx.principal.id,
          );
          if (validScopedIds.length !== uniqueAssigneeIds.length) {
            const outOfScope = uniqueAssigneeIds.filter((id) => !validScopedIds.includes(id));
            throw new TaskValidationError(
              TASK_ERROR_CODES.TASK_ASSIGNEE_NOT_FOUND,
              'One or more assignees are outside your department scope',
              { missingAssigneeIds: outOfScope },
            );
          }
        } else if (assignPolicy && assignPolicy.scope === 'pool') {
          const poolMembers = await scopeResolver.poolMemberIds(ctx);
          const poolIds = await scopeResolver.poolIds(ctx);
          const validScopedIds = await validateAssigneesInPoolScope(
            tx,
            ctx.organizationId,
            uniqueAssigneeIds,
            poolMembers,
            poolIds,
            ctx.principal.id,
          );
          if (validScopedIds.length !== uniqueAssigneeIds.length) {
            const outOfScope = uniqueAssigneeIds.filter((id) => !validScopedIds.includes(id));
            throw new TaskValidationError(
              TASK_ERROR_CODES.TASK_ASSIGNEE_NOT_FOUND,
              'One or more assignees are outside your pool scope',
              { missingAssigneeIds: outOfScope },
            );
          }
        }
      }
    }

    const { id } = await insertTaskRow(tx, {
      organizationId: ctx.organizationId,
      title: input.title,
      description: input.description ?? null,
      projectId: input.projectId ?? null,
      priority: input.priority ?? 'medium',
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

  const isAssignee = existing.assignees.some((a) => a.id === ctx.principal.id);
  const targetUserId =
    input.userId ?? (isAssignee ? ctx.principal.id : undefined);

  if (targetUserId) {
    const assignee = existing.assignees.find((a) => a.id === targetUserId);
    if (!assignee) {
      throw new TaskValidationError(
        TASK_ERROR_CODES.TASK_ASSIGNEE_NOT_FOUND,
        'Specified user is not assigned to this task',
        { targetUserId },
      );
    }

    assertValidTransition(assignee.status, input.status);

    if (targetUserId !== ctx.principal.id && !globalAccess(ctx.principal)) {
      const updatePolicy = await effectivePolicy(ctx, 'tasks:update');
      if (!updatePolicy || !updatePolicy.allowed) {
        throw new AuthorizationError(
          'tasks:update',
          'no_policy',
          'No policy grants tasks:update to this principal.',
        );
      }
      if (updatePolicy.scope === 'own' || updatePolicy.scope === 'participant') {
        throw new AuthorizationError(
          'tasks:update',
          'out_of_scope',
          'Cannot modify another assignee status under own/participant scope.',
        );
      }
      if (updatePolicy.scope === 'team') {
        const allowedTeams = await scopeResolver.teamIds(ctx);
        if (!assignee.teamId || !allowedTeams.has(assignee.teamId)) {
          throw new AuthorizationError(
            'tasks:update',
            'out_of_scope',
            'Assignee is outside your team scope.',
          );
        }
      } else if (updatePolicy.scope === 'department') {
        const allowedDeptId = await scopeResolver.departmentId(ctx);
        if (!assignee.departmentId || assignee.departmentId !== allowedDeptId) {
          throw new AuthorizationError(
            'tasks:update',
            'out_of_scope',
            'Assignee is outside your department scope.',
          );
        }
      } else if (updatePolicy.scope === 'pool') {
        const poolMembers = await scopeResolver.poolMemberIds(ctx);
        if (!poolMembers.has(targetUserId)) {
          throw new AuthorizationError(
            'tasks:update',
            'out_of_scope',
            'Assignee is outside your pool scope.',
          );
        }
      }
    }

    return db.transaction(ctx, async (tx) => {
      await updateTaskAssigneeStatus(
        tx,
        ctx.organizationId,
        id,
        targetUserId,
        input.status,
      );

      const action =
        input.status === 'completed'
          ? 'task.assignee_completed'
          : 'task.assignee_status_changed';

      await enqueueTaskAudit(tx, ctx, {
        action,
        targetId: id,
        before: { assigneeId: targetUserId, status: assignee.status },
        after: {
          assigneeId: targetUserId,
          status: input.status,
          notes: input.notes ?? null,
        },
      });

      const updated = await findTaskByIdTx(tx, ctx.organizationId, id);
      if (!updated) {
        throw new TaskNotFoundError();
      }
      return updated;
    });
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

export async function updateAssignmentStatus(
  ctx: RequestContext,
  taskId: string,
  userId: string,
  status: TaskStatus,
  notes?: string | null,
): Promise<Task> {
  return transitionTask(ctx, taskId, { status, userId, notes });
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

      if (!globalAccess(ctx.principal)) {
        const assignPolicy = await effectivePolicy(ctx, 'tasks:assign');
        if (assignPolicy && assignPolicy.scope === 'team') {
          const allowedTeams = await scopeResolver.teamIds(ctx);
          const validScopedIds = await validateAssigneesInTeamScope(
            tx,
            ctx.organizationId,
            uniqueAssigneeIds,
            allowedTeams,
            ctx.principal.id,
          );
          if (validScopedIds.length !== uniqueAssigneeIds.length) {
            const outOfScope = uniqueAssigneeIds.filter((mId) => !validScopedIds.includes(mId));
            throw new TaskValidationError(
              TASK_ERROR_CODES.TASK_ASSIGNEE_NOT_FOUND,
              'One or more assignees are outside your team scope',
              { missingAssigneeIds: outOfScope },
            );
          }
        } else if (assignPolicy && assignPolicy.scope === 'department') {
          const departmentId = await scopeResolver.departmentId(ctx);
          const validScopedIds = await validateAssigneesInDepartmentScope(
            tx,
            ctx.organizationId,
            uniqueAssigneeIds,
            departmentId,
            ctx.principal.id,
          );
          if (validScopedIds.length !== uniqueAssigneeIds.length) {
            const outOfScope = uniqueAssigneeIds.filter((mId) => !validScopedIds.includes(mId));
            throw new TaskValidationError(
              TASK_ERROR_CODES.TASK_ASSIGNEE_NOT_FOUND,
              'One or more assignees are outside your department scope',
              { missingAssigneeIds: outOfScope },
            );
          }
        } else if (assignPolicy && assignPolicy.scope === 'pool') {
          const poolMembers = await scopeResolver.poolMemberIds(ctx);
          const poolIds = await scopeResolver.poolIds(ctx);
          const validScopedIds = await validateAssigneesInPoolScope(
            tx,
            ctx.organizationId,
            uniqueAssigneeIds,
            poolMembers,
            poolIds,
            ctx.principal.id,
          );
          if (validScopedIds.length !== uniqueAssigneeIds.length) {
            const outOfScope = uniqueAssigneeIds.filter((mId) => !validScopedIds.includes(mId));
            throw new TaskValidationError(
              TASK_ERROR_CODES.TASK_ASSIGNEE_NOT_FOUND,
              'One or more assignees are outside your pool scope',
              { missingAssigneeIds: outOfScope },
            );
          }
        }
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

export async function listTaskAssignees(
  ctx: RequestContext,
  query: TaskAssigneesQueryInput,
): Promise<readonly TaskAssignableUser[]> {
  // 1. Super Admin: full tenant access
  if (globalAccess(ctx.principal)) {
    return findAssignableUsers(ctx, { kind: 'all' }, query);
  }

  // 2. Resolve caller's effective policy on tasks:assign
  const policy = await effectivePolicy(ctx, 'tasks:assign');
  if (!policy || !policy.allowed) {
    return [];
  }

  // 3. Determine scope
  if (policy.scope === 'all-people') {
    return findAssignableUsers(ctx, { kind: 'all' }, query);
  }

  if (policy.scope === 'department') {
    const departmentId = await scopeResolver.departmentId(ctx);
    return findAssignableUsers(ctx, { kind: 'department', departmentId }, query);
  }

  if (policy.scope === 'team') {
    const teamIds = [...(await scopeResolver.teamIds(ctx))];
    return findAssignableUsers(ctx, { kind: 'team', teamIds }, query);
  }

  if (policy.scope === 'pool') {
    const poolMemberIds = [...(await scopeResolver.poolMemberIds(ctx))];
    return findAssignableUsers(ctx, { kind: 'pool', poolMemberIds }, query);
  }

  if (policy.scope === 'own' || policy.scope === 'participant') {
    const isProjectManager = await isPrincipalProjectManager(ctx);
    const departmentId = await scopeResolver.departmentId(ctx);
    return findAssignableUsers(
      ctx,
      { kind: 'own', isProjectManager, departmentId },
      query,
    );
  }

  return [];
}

