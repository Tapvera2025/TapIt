import type { RequestContext } from '../../platform/dal/context.js';
import type { Tx } from '../../platform/dal/db.js';
import { NOTIFICATION_TYPES, notify } from '../notifications/facade.js';
import type { Task, TaskPriority, TaskStatus } from './types.js';
import type { UpdateTaskInput } from './validators.js';

/**
 * Task notifications — the REFERENCE example of wiring a module to the
 * notification engine. Read team-docs/notification-engine-guide.md first.
 *
 * The pattern, which any module can copy:
 *
 *   1. One small file like this per module. It is the ONLY place that knows what
 *      each domain event means to a human: who hears about it, what it says.
 *   2. `service.ts` stays readable: after its own work (and audit entry) it makes
 *      ONE call into this file, INSIDE the same transaction. If the business
 *      change rolls back, the notification is never created.
 *   3. This file imports the engine only through `notifications/facade.js`.
 *
 * Who is told what:
 *
 *   event                  who                          type                priority
 *   ─────────────────────  ───────────────────────────  ──────────────────  ─────────────
 *   task created           its assignees                task.assigned       operational
 *   assignee added         the added people             task.assigned       operational
 *   assignee removed       the removed people           task.unassigned     informational
 *   details changed        current assignees            task.updated        informational
 *   status changed         creator + assignees          task.status_changed informational
 *   completed              creator + assignees          task.completed      informational
 *
 * Whoever performed the action (the actor) is never notified about their own
 * action. Reads (GET) never notify. The tasks module has no delete operation;
 * cancelling is a status change and is covered above.
 */

/** In-app page for tasks. `metadata.taskId` is there for future deep linking. */
const TASKS_LINK = '/company/tasks';

const STATUS_LABELS: Record<TaskStatus, string> = {
  pending: 'Pending',
  in_progress: 'In progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

/** The bits of a task a notification needs; both `Task` and create input satisfy it. */
export interface TaskRef {
  readonly id: string;
  readonly title: string;
  readonly priority: TaskPriority;
  readonly dueDate?: Date | string | null | undefined;
}

/** Unique ids, minus the actor. Empty means "nobody to tell" and we skip `notify`. */
function recipients(ids: readonly string[], ctx: RequestContext): string[] {
  return [...new Set(ids)].filter((id) => id !== ctx.principal.id);
}

const clip = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

const isoDay = (value: Date | string): string => new Date(value).toISOString().slice(0, 10);

/** People who are on the hook for the task, plus whoever created it. */
function stakeholderIds(task: Pick<Task, 'createdBy' | 'assignees'>): string[] {
  return [task.createdBy, ...task.assignees.map((a) => a.id)];
}

/** New assignees. Operational: someone now has work to do. */
export async function notifyTaskAssigned(
  tx: Tx,
  ctx: RequestContext,
  task: TaskRef,
  userIds: readonly string[],
): Promise<void> {
  const audience = recipients(userIds, ctx);
  if (audience.length === 0) return;

  await notify(tx, ctx, {
    type: NOTIFICATION_TYPES.TASK_ASSIGNED,
    priority: 'operational',
    audience: { users: audience },
    title: 'New task assigned to you',
    body: clip(task.dueDate ? `${task.title} — due ${isoDay(task.dueDate)}` : task.title, 500),
    link: TASKS_LINK,
    metadata: { taskId: task.id, priority: task.priority },
  });
}

/** People taken off a task. Informational: nothing for them to do. */
export async function notifyTaskUnassigned(
  tx: Tx,
  ctx: RequestContext,
  task: Pick<TaskRef, 'id' | 'title'>,
  userIds: readonly string[],
): Promise<void> {
  const audience = recipients(userIds, ctx);
  if (audience.length === 0) return;

  await notify(tx, ctx, {
    type: NOTIFICATION_TYPES.TASK_UNASSIGNED,
    audience: { users: audience },
    title: 'You were removed from a task',
    body: clip(task.title, 500),
    link: TASKS_LINK,
    metadata: { taskId: task.id },
  });
}

/**
 * Which user-visible fields does this update really change? Comparing against the
 * stored task (not just "was the field sent") means saving a form without edits
 * does not spam anyone.
 */
export function changedTaskFields(
  existing: Pick<Task, 'title' | 'description' | 'priority' | 'dueDate' | 'projectId'>,
  input: UpdateTaskInput,
): string[] {
  const time = (value: Date | string | null | undefined): number | null =>
    value === null || value === undefined ? null : new Date(value).getTime();

  const changed: string[] = [];
  if (input.title !== undefined && input.title !== existing.title) changed.push('title');
  if (input.description !== undefined && (input.description ?? null) !== existing.description) {
    changed.push('description');
  }
  if (input.priority !== undefined && input.priority !== existing.priority) changed.push('priority');
  if (input.dueDate !== undefined && time(input.dueDate) !== time(existing.dueDate)) {
    changed.push('due date');
  }
  if (input.projectId !== undefined && (input.projectId ?? null) !== existing.projectId) {
    changed.push('project');
  }
  return changed;
}

/** Details edited. Tells the current assignees what changed (not the new values). */
export async function notifyTaskUpdated(
  tx: Tx,
  ctx: RequestContext,
  existing: Pick<Task, 'id' | 'title' | 'assignees'>,
  changedFields: readonly string[],
): Promise<void> {
  const audience = recipients(
    existing.assignees.map((a) => a.id),
    ctx,
  );
  if (audience.length === 0 || changedFields.length === 0) return;

  await notify(tx, ctx, {
    type: NOTIFICATION_TYPES.TASK_UPDATED,
    audience: { users: audience },
    title: 'A task assigned to you was updated',
    body: clip(`${existing.title} — changed: ${changedFields.join(', ')}`, 500),
    link: TASKS_LINK,
    metadata: { taskId: existing.id },
  });
}

/** Status moved. The creator hears too, since they are waiting on the outcome. */
export async function notifyTaskStatusChanged(
  tx: Tx,
  ctx: RequestContext,
  existing: Pick<Task, 'id' | 'title' | 'status' | 'createdBy' | 'assignees'>,
  to: TaskStatus,
): Promise<void> {
  if (to === existing.status) return;
  const audience = recipients(stakeholderIds(existing), ctx);
  if (audience.length === 0) return;

  const completed = to === 'completed';
  await notify(tx, ctx, {
    type: completed ? NOTIFICATION_TYPES.TASK_COMPLETED : NOTIFICATION_TYPES.TASK_STATUS_CHANGED,
    audience: { users: audience },
    title: completed ? 'Task completed' : to === 'cancelled' ? 'Task cancelled' : 'Task status changed',
    body: clip(`${existing.title} — ${STATUS_LABELS[existing.status]} → ${STATUS_LABELS[to]}`, 500),
    link: TASKS_LINK,
    metadata: { taskId: existing.id, from: existing.status, to },
  });
}
