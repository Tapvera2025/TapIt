import { useState } from 'react';
import { Empty, Loading } from '../../../ui/components.js';
import type { Task, TaskListProps, TaskStatus } from '../types/index.js';
import { TaskPriorityBadge, TaskStatusBadge } from './TaskStatusBadge.js';

const VALID_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  pending: ['in_progress', 'completed', 'cancelled'],
  in_progress: ['completed', 'pending', 'cancelled'],
  completed: ['in_progress', 'pending'],
  cancelled: ['pending', 'in_progress'],
};

const TRANSITION_LABELS: Record<TaskStatus, string> = {
  pending: 'Set Pending',
  in_progress: 'Start Progress',
  completed: 'Mark Completed',
  cancelled: 'Cancel Task',
};

function formatDate(dateValue: string | null): string {
  if (!dateValue) return 'No due date';
  try {
    const d = new Date(dateValue);
    if (isNaN(d.getTime())) return dateValue;
    return d.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return dateValue;
  }
}

export function TaskList({
  tasks,
  loading = false,
  onTransitionStatus,
  onEditTask,
  onAssignTask,
}: TaskListProps): React.JSX.Element {
  const [transitioningTaskId, setTransitioningTaskId] = useState<string | null>(
    null,
  );
  const [transitionError, setTransitionError] = useState<{
    taskId: string;
    message: string;
  } | null>(null);

  if (loading) {
    return <Loading />;
  }

  if (tasks.length === 0) {
    return (
      <Empty>No tasks found. Try adjusting your filters or create a new task.</Empty>
    );
  }

  async function handleTransition(taskId: string, targetStatus: TaskStatus) {
    try {
      setTransitioningTaskId(taskId);
      setTransitionError(null);
      await onTransitionStatus(taskId, targetStatus);
    } catch (err) {
      setTransitionError({
        taskId,
        message:
          err instanceof Error
            ? err.message
            : 'Failed to transition task status',
      });
    } finally {
      setTransitioningTaskId(null);
    }
  }

  return (
    <div className="space-y-3">
      {tasks.map((task) => {
        const isBusy = transitioningTaskId === task.id;
        const availableTransitions = VALID_TRANSITIONS[task.status] ?? [];
        const isOverdue =
          task.dueDate &&
          task.status !== 'completed' &&
          task.status !== 'cancelled' &&
          new Date(task.dueDate).getTime() < Date.now();

        return (
          <article
            key={task.id}
            className="rounded-xl border border-app-border bg-app-surface p-4 transition hover:border-app-accent/40 shadow-sm"
          >
            {/* Header: Title, Priority, Status, and Actions */}
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-display text-base font-bold text-app-foreground">
                    {task.title}
                  </h3>
                  <TaskPriorityBadge priority={task.priority} />
                  <TaskStatusBadge status={task.status} />
                  {isOverdue && (
                    <span className="rounded bg-rose-500/15 px-2 py-0.5 text-[11px] font-bold text-rose-600 dark:text-rose-400">
                      Overdue
                    </span>
                  )}
                </div>

                {task.description && (
                  <p className="line-clamp-2 text-xs text-app-muted">
                    {task.description}
                  </p>
                )}
              </div>

              {/* Quick action buttons */}
              <div className="flex flex-wrap items-center gap-1.5 self-start pt-1 sm:pt-0">
                {/* Status Transition Select */}
                {availableTransitions.length > 0 && (
                  <div className="relative">
                    <select
                      disabled={isBusy}
                      value=""
                      onChange={(e) => {
                        if (e.target.value) {
                          void handleTransition(
                            task.id,
                            e.target.value as TaskStatus,
                          );
                        }
                      }}
                      className="rounded-lg border border-app-border bg-app-background px-2 py-1 text-xs font-semibold text-app-foreground outline-none hover:border-app-accent focus:border-app-accent disabled:opacity-50"
                      aria-label="Change task status"
                    >
                      <option value="">Move to...</option>
                      {availableTransitions.map((status) => (
                        <option key={status} value={status}>
                          {TRANSITION_LABELS[status] ?? status}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Edit Button */}
                {onEditTask && (
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => onEditTask(task)}
                    className="rounded-lg border border-app-border bg-app-surface px-2.5 py-1 text-xs font-semibold text-app-foreground hover:border-app-accent hover:bg-app-background"
                    aria-label={`Edit task ${task.title}`}
                  >
                    Edit
                  </button>
                )}

                {/* Assign Button */}
                {onAssignTask && (
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => onAssignTask(task)}
                    className="rounded-lg border border-app-border bg-app-surface px-2.5 py-1 text-xs font-semibold text-app-foreground hover:border-app-accent hover:bg-app-background"
                    aria-label={`Manage assignees for ${task.title}`}
                  >
                    Assign
                  </button>
                )}
              </div>
            </div>

            {/* Transition Error Message if any */}
            {transitionError?.taskId === task.id && (
              <div className="mt-2 text-xs text-app-danger" role="alert">
                {transitionError.message}
              </div>
            )}

            {/* Footer Metadata: Due Date, Project, Assignees, Created */}
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-app-border/50 pt-2.5 text-xs text-app-muted">
              {/* Due Date & Project */}
              <div className="flex flex-wrap items-center gap-4">
                <div className="flex items-center gap-1.5">
                  <span className="font-semibold">Due:</span>
                  <span
                    className={
                      isOverdue ? 'font-bold text-rose-600 dark:text-rose-400' : ''
                    }
                  >
                    {formatDate(task.dueDate)}
                  </span>
                </div>

                {task.projectId && (
                  <div className="flex items-center gap-1.5">
                    <span className="font-semibold">Project:</span>
                    <span className="font-mono text-[11px]">
                      {task.projectId.slice(0, 8)}...
                    </span>
                  </div>
                )}
              </div>

              {/* Assignees (Multi-employee rendered together in single row) */}
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-semibold">Assigned:</span>
                {task.assignees.length === 0 ? (
                  <span className="italic text-app-muted">Unassigned</span>
                ) : (
                  <div className="flex flex-wrap gap-1">
                    {task.assignees.map((assignee) => (
                      <span
                        key={assignee.id}
                        className="inline-flex items-center rounded-md border border-app-border bg-app-background px-2 py-0.5 text-[11px] font-medium text-app-foreground"
                      >
                        {assignee.fullName}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}
