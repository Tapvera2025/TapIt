import type { Resource } from '@tapcrm/authz';
import { AuthorizationError, effectivePolicy, visibilityFilter } from '@tapcrm/authz';
import { globalAccess } from '@tapcrm/contracts';
import { scopeResolver } from '../../platform/authz-adapter.js';
import type { RequestContext } from '../../platform/dal/context.js';
import { db } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import { emitToOrganization, emitToUser } from '../../platform/realtime/index.js';
import {
  TASK_ERROR_CODES,
  TaskNotFoundError,
  TaskValidationError,
} from './errors.js';
import {
  changedTaskFields,
  notifyTaskAssigned,
  notifyTaskStatusChanged,
  notifyTaskUnassigned,
  notifyTaskUpdated,
} from './notifications.js';
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
  findLedTeamIds,
  findUsersInAssignableScope,
  type AssignableUsersScope,
} from './repository.js';
import type { Tx } from '../../platform/dal/db.js';
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

/** Validate a multi-step lifecycle path while committing only its final status. */
function assertValidTransitionPath(
  current: TaskStatus,
  target: TaskStatus,
  viaStatus?: TaskStatus,
): void {
  if (!viaStatus) {
    assertValidTransition(current, target);
    return;
  }

  assertValidTransition(current, viaStatus);
  assertValidTransition(viaStatus, target);
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

function emitTaskRealtime(
  organizationId: string,
  event: 'task:created' | 'task:updated' | 'task:deleted',
  task: Task,
): void {
  emitToOrganization(organizationId, event, {
    id: task.id,
    status: task.status,
    task,
  });
  const stakeholderIds = new Set([task.createdBy, ...task.assignees.map((a) => a.id)]);
  for (const stakeholderId of stakeholderIds) {
    emitToUser(organizationId, stakeholderId, event, {
      id: task.id,
      status: task.status,
      task,
    });
  }
}

export async function createTask(
  ctx: RequestContext,
  input: CreateTaskInput,
): Promise<Task> {
  const uniqueAssigneeIds = [...new Set(input.assigneeIds ?? [])];

  const created = await db.transaction(ctx, async (tx) => {
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

      await assertAssigneesInScope(tx, ctx, uniqueAssigneeIds);
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

    await notifyTaskAssigned(
      tx,
      ctx,
      { id, title: input.title, priority: input.priority, dueDate: input.dueDate ?? null },
      uniqueAssigneeIds,
    );

    const created = await findTaskByIdTx(tx, ctx.organizationId, id);
    if (!created) {
      throw new Error('Failed to load task immediately after creation');
    }

    return created;
  });

  emitTaskRealtime(ctx.organizationId, 'task:created', created);
  return created;
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

  const updated = await db.transaction(ctx, async (tx) => {
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

    await notifyTaskUpdated(tx, ctx, existing, changedTaskFields(existing, input));

    const taskResult = await findTaskByIdTx(tx, ctx.organizationId, id);
    if (!taskResult) {
      throw new TaskNotFoundError();
    }
    return taskResult;
  });

  emitTaskRealtime(ctx.organizationId, 'task:updated', updated);
  return updated;
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

  // Authorization check: task can only be cancelled by super admin and the particular employee who created the task
  if (input.status === 'cancelled') {
    const isSuperAdmin = globalAccess(ctx.principal) || ctx.principal.accountType === 'super-admin';
    const isCreator = existing.createdBy === ctx.principal.id;
    if (!isSuperAdmin && !isCreator) {
      throw new AuthorizationError(
        'tasks:update',
        'not_allowed',
        'Only a super admin or the employee who created the task can cancel it.',
      );
    }
  }

  const isSuperAdmin = globalAccess(ctx.principal) || ctx.principal.accountType === 'super-admin';
  const isAssignee = existing.assignees.some((a) => a.id === ctx.principal.id);
  const targetUserId =
    input.userId ?? (!isSuperAdmin && isAssignee ? ctx.principal.id : undefined);

  if (targetUserId) {
    const assignee = existing.assignees.find((a) => a.id === targetUserId);
    if (!assignee) {
      throw new TaskValidationError(
        TASK_ERROR_CODES.TASK_ASSIGNEE_NOT_FOUND,
        'Specified user is not assigned to this task',
        { targetUserId },
      );
    }

    assertValidTransitionPath(assignee.status, input.status, input.viaStatus);

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

    const updated = await db.transaction(ctx, async (tx) => {
      await updateTaskAssigneeStatus(
        tx,
        ctx.organizationId,
        id,
        targetUserId,
        input.status,
      );

      // Check if all assignees have completed
      const allCompleted = existing.assignees.every((a) =>
        a.id === targetUserId ? input.status === 'completed' : a.status === 'completed',
      );
      if (allCompleted && existing.status !== 'completed') {
        await updateTaskRow(tx, ctx.organizationId, id, { status: 'completed' });
      } else if (input.status === 'in_progress' && existing.status === 'pending') {
        await updateTaskRow(tx, ctx.organizationId, id, { status: 'in_progress' });
      }

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

      // The creator and the other assignees hear about it; the actor does not.
      // `from` is this assignee's previous status — the task's own status is not
      // what moved.
      await notifyTaskStatusChanged(tx, ctx, { ...existing, status: assignee.status }, input.status);

      const taskResult = await findTaskByIdTx(tx, ctx.organizationId, id);
      if (!taskResult) {
        throw new TaskNotFoundError();
      }
      return taskResult;
    });

    emitTaskRealtime(ctx.organizationId, 'task:updated', updated);
    return updated;
  }

  assertValidTransitionPath(existing.status, input.status, input.viaStatus);

  const updated = await db.transaction(ctx, async (tx) => {
    await updateTaskRow(tx, ctx.organizationId, id, {
      status: input.status,
    });

    // Synchronize all task assignees with the new task status
    await tx.query(sql`
      UPDATE task_assignee
      SET status = ${input.status}
      WHERE organization_id = ${ctx.organizationId} AND task_id = ${id}
    `);

    const action =
      input.status === 'completed' ? 'task.completed' : 'task.status_changed';

    await enqueueTaskAudit(tx, ctx, {
      action,
      targetId: id,
      before: { status: existing.status },
      after: { status: input.status, notes: input.notes ?? null },
    });

    await notifyTaskStatusChanged(tx, ctx, existing, input.status);

    const taskResult = await findTaskByIdTx(tx, ctx.organizationId, id);
    if (!taskResult) {
      throw new TaskNotFoundError();
    }
    return taskResult;
  });

  emitTaskRealtime(ctx.organizationId, 'task:updated', updated);
  return updated;
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

  const updated = await db.transaction(ctx, async (tx) => {
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

      await assertAssigneesInScope(tx, ctx, uniqueAssigneeIds);
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

    // Only the DIFFERENCE is news: re-saving the same list notifies nobody.
    const before = new Set(existing.assignees.map((a) => a.id));
    const after = new Set(uniqueAssigneeIds);
    await notifyTaskAssigned(
      tx,
      ctx,
      existing,
      uniqueAssigneeIds.filter((userId) => !before.has(userId)),
    );
    await notifyTaskUnassigned(
      tx,
      ctx,
      existing,
      [...before].filter((userId) => !after.has(userId)),
    );

    const updated = await findTaskByIdTx(tx, ctx.organizationId, id);
    if (!updated) {
      throw new TaskNotFoundError();
    }
    return updated;
  });

  emitTaskRealtime(ctx.organizationId, 'task:updated', updated);
  return updated;
}

export async function listTaskAssignees(
  ctx: RequestContext,
  query: TaskAssigneesQueryInput,
): Promise<readonly TaskAssignableUser[]> {
  const scope = await resolveAssignableScope(ctx);
  if (scope.kind === 'none') return [];
  return findAssignableUsers(ctx, scope, query);
}

/**
 * Who the caller may assign a task to (PA-6, TK-8), from their effective
 * `tasks:assign` scope:
 *
 *   all-people   anyone in the organization (Super Admin, HR)
 *   department   their department
 *   team         their team tree and every team they lead
 *   pool         their pool
 *   own          themselves only — a Project Manager also directs the
 *                development department
 *
 * Every scope also covers the people who report to the caller, directly or
 * not: a manager can always give work to their own reports, whether or not
 * the org chart puts them in the same team. Before this, `own` was not checked
 * at all, so any employee could assign a task to anyone in any department,
 * while a team manager was refused for a direct report outside their team.
 */
export async function resolveAssignableScope(
  ctx: RequestContext,
): Promise<AssignableUsersScope> {
  if (globalAccess(ctx.principal)) return { kind: 'all' };
  const policy = await effectivePolicy(ctx, 'tasks:assign');
  if (!policy || !policy.allowed) return { kind: 'none' };
  if (policy.scope === 'all-people') return { kind: 'all' };

  const reports = await scopeResolver.subordinateIds(ctx);
  const userIds = [...new Set([ctx.principal.id, ...reports])];

  if (policy.scope === 'department') {
    return { kind: 'scoped', userIds, departmentId: await scopeResolver.departmentId(ctx) };
  }
  if (policy.scope === 'team') {
    const teams = new Set<string>(await scopeResolver.teamIds(ctx));
    for (const id of await findLedTeamIds(ctx)) teams.add(id);
    return { kind: 'scoped', userIds, teamIds: [...teams] };
  }
  if (policy.scope === 'pool') {
    const members = await scopeResolver.poolMemberIds(ctx);
    const pools = await scopeResolver.poolIds(ctx);
    return { kind: 'scoped', userIds: [...new Set([...userIds, ...members])], teamIds: [...pools] };
  }
  // own / participant
  if (await isPrincipalProjectManager(ctx)) {
    return { kind: 'scoped', userIds, departmentCode: 'development' };
  }
  return { kind: 'scoped', userIds };
}

const SCOPE_MESSAGE: Record<string, string> = {
  department: 'You can assign tasks only to people in your department or who report to you',
  team: 'You can assign tasks only to your team or to people who report to you',
  pool: 'You can assign tasks only to your pool or to people who report to you',
  own: 'You can assign tasks only to yourself or to people who report to you',
};

async function assertAssigneesInScope(
  tx: Tx,
  ctx: RequestContext,
  assigneeIds: readonly string[],
): Promise<void> {
  if (assigneeIds.length === 0) return;
  const scope = await resolveAssignableScope(ctx);
  if (scope.kind === 'all') return;
  const inScope = new Set(
    await findUsersInAssignableScope(tx, ctx.organizationId, assigneeIds, scope),
  );
  const outOfScope = assigneeIds.filter((id) => !inScope.has(id));
  if (outOfScope.length === 0) return;
  const policy = await effectivePolicy(ctx, 'tasks:assign');
  const key = policy?.scope === 'participant' ? 'own' : (policy?.scope ?? 'own');
  throw new TaskValidationError(
    TASK_ERROR_CODES.TASK_ASSIGNEE_NOT_FOUND,
    SCOPE_MESSAGE[key] ?? SCOPE_MESSAGE['own']!,
    { missingAssigneeIds: outOfScope },
  );
}
