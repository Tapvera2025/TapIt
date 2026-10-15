import { useState } from 'react';
import { SkeletonTable } from '../../../ui/components.js';
import type { TaskListProps, TaskStatus } from '../types/index.js';
import { TaskPriorityBadge, TaskStatusBadge } from './TaskStatusBadge.js';

const VALID_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  pending: ['in_progress', 'completed', 'cancelled'],
  in_progress: ['completed', 'pending', 'cancelled'],
  completed: ['in_progress', 'pending'],
  cancelled: ['pending', 'in_progress'],
};

const TRANSITION_LABELS: Record<TaskStatus, string> = {
  pending: 'Pending',
  in_progress: 'In Progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

function formatDate(dateValue: string | null): string {
  if (!dateValue) return '';
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
  currentUserId,
  onTransitionStatus,
  onEditTask,
  onAssignTask,
}: TaskListProps): React.JSX.Element {
  const [transitioningTaskId, setTransitioningTaskId] = useState<string | null>(null);
  const [transitionError, setTransitionError] = useState<{
    taskId: string;
    message: string;
  } | null>(null);
  const [openStatusMenu, setOpenStatusMenu] = useState<string | null>(null);

  if (loading) {
    return <SkeletonTable columns={5} rows={7} />;
  }

  if (tasks.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-app-border bg-app-surface/60 px-6 py-10 text-center">
        <p className="text-sm font-semibold text-app-foreground">No tasks found</p>
        <p className="mt-1 text-xs text-app-muted">
          Try adjusting your filters or create a new task.
        </p>
      </div>
    );
  }

  async function handleTransition(
    taskId: string,
    targetStatus: TaskStatus,
    userId?: string,
  ) {
    try {
      setTransitioningTaskId(taskId);
      setTransitionError(null);
      await onTransitionStatus(taskId, targetStatus, userId);
    } catch (err) {
      setTransitionError({
        taskId,
        message: err instanceof Error ? err.message : 'Failed to transition task status',
      });
    } finally {
      setTransitioningTaskId(null);
    }
  }

  return (
    <div className="space-y-3 lg:space-y-3">
      {tasks.map((task) => {
        const isBusy = transitioningTaskId === task.id;
        const myAssignment = currentUserId
          ? task.assignees.find((a) => a.id === currentUserId)
          : undefined;
        const availableTransitions = myAssignment
          ? (VALID_TRANSITIONS[myAssignment.status] ?? [])
          : (VALID_TRANSITIONS[task.status] ?? []);

        return (
          <article
            key={task.id}
            className="rounded-2xl border border-app-border/80 bg-app-surface/75 p-4 transition-colors hover:border-app-accent/40 sm:p-5 lg:p-5"
          >
            <div className="grid gap-4 lg:grid-cols-[minmax(16rem,1.2fr)_minmax(15rem,0.9fr)_auto] lg:items-center lg:gap-6">
              <div className="min-w-0">
                <h3 className="break-words text-sm font-semibold leading-snug text-app-foreground sm:text-base">
                  {task.title}
                </h3>

                {task.description && (
                  <p className="mt-1.5 text-xs text-app-muted line-clamp-2 leading-relaxed">
                    {task.description}
                  </p>
                )}
              </div>

              <div className="flex min-w-0 flex-col items-start gap-2 text-xs text-app-muted">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <TaskPriorityBadge priority={task.priority} />
                  {task.projectId && (
                    <span className="max-w-full truncate rounded-md border border-app-border/70 bg-app-background/50 px-2 py-1">
                      {task.projectName ?? 'Unknown project'}
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {task.dueDate && (
                    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border border-app-border/70 bg-app-background/50 px-2 py-1">
                      <span className="text-app-muted">Due</span>
                      <time className="font-medium text-app-foreground" dateTime={task.dueDate}>
                        {formatDate(task.dueDate)}
                      </time>
                    </span>
                  )}
                  {task.createdAt && (
                    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border border-app-border/70 bg-app-background/50 px-2 py-1">
                      <span className="text-app-muted">Created</span>
                      <time className="font-medium text-app-foreground" dateTime={task.createdAt}>
                        {formatDate(task.createdAt)}
                      </time>
                    </span>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-1.5 lg:flex-nowrap lg:justify-end">
                {availableTransitions.length === 0 ? (
                  <TaskStatusBadge status={task.status} />
                ) : (
                  <div className="relative">
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() =>
                        setOpenStatusMenu(openStatusMenu === task.id ? null : task.id)
                      }
                      className="disabled:opacity-50"
                      aria-label={
                        myAssignment ? 'Change my task status' : 'Change task status'
                      }
                    >
                      <TaskStatusBadge
                        status={task.status}
                        className="cursor-pointer hover:ring-1 hover:ring-app-accent/40"
                      />
                    </button>
                    {openStatusMenu === task.id && (
                      <div className="absolute left-0 top-full z-20 mt-1 min-w-32 rounded-lg border border-app-border bg-app-surface py-1 text-xs shadow-lg">
                        {availableTransitions.map((status) => (
                          <button
                            key={status}
                            type="button"
                            onClick={() => {
                              setOpenStatusMenu(null);
                              void handleTransition(task.id, status, myAssignment?.id);
                            }}
                            className="block w-full px-3 py-1.5 text-left hover:bg-app-surface-raised"
                          >
                            {TRANSITION_LABELS[status] ?? status}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Edit Button */}
                {onEditTask && (
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => onEditTask(task)}
                    className="h-7 rounded-lg border border-app-border bg-app-background/60 px-2.5 text-xs font-medium text-app-foreground transition hover:border-app-accent/60 hover:bg-app-surface-raised disabled:opacity-50"
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
                    className="h-7 rounded-lg border border-app-border bg-app-background/60 px-2.5 text-xs font-medium text-app-foreground transition hover:border-app-accent/60 hover:bg-app-surface-raised disabled:opacity-50"
                    aria-label={`Manage assignees for ${task.title}`}
                  >
                    Assign
                  </button>
                )}
              </div>
            </div>

            {transitionError?.taskId === task.id && (
              <div className="mt-2 text-xs text-app-danger" role="alert">
                {transitionError.message}
              </div>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-app-border/40 pt-3 text-xs text-app-muted">
              <div className="flex items-center gap-1.5">
                <span className="text-app-muted">Created by:</span>
                <span className="font-medium text-app-foreground">
                  {task.createdByName || 'Unknown'}
                </span>
              </div>

              <span className="mx-1 text-app-muted/50" aria-hidden="true">
                →
              </span>

              <div className="flex flex-wrap items-center gap-2">
                <span className="text-app-muted">Assigned to:</span>
                {task.assignees.length === 0 ? (
                  <span className="italic text-app-muted/80">Unassigned</span>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    {task.assignees.map((assignee) => {
                      const isSelf = currentUserId === assignee.id;
                      const assigneeTransitions =
                        VALID_TRANSITIONS[assignee.status] ?? [];
                      return (
                        <div
                          key={assignee.id}
                          className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs ${
                            isSelf
                              ? 'border-app-accent/40 bg-app-accent/5'
                              : 'border-app-border/60 bg-app-background'
                          }`}
                        >
                          <span
                            className={`font-medium ${
                              isSelf
                                ? 'text-app-accent font-semibold'
                                : 'text-app-foreground'
                            }`}
                          >
                            {assignee.fullName} {isSelf && '(You)'}
                          </span>
                          {assigneeTransitions.length === 0 ? (
                            <TaskStatusBadge status={assignee.status} />
                          ) : (
                            <div className="relative">
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() =>
                                  setOpenStatusMenu(
                                    openStatusMenu === `${task.id}:${assignee.id}`
                                      ? null
                                      : `${task.id}:${assignee.id}`,
                                  )
                                }
                                className="disabled:opacity-50"
                                aria-label={`Change status for ${assignee.fullName}`}
                              >
                                <TaskStatusBadge
                                  status={assignee.status}
                                  className="cursor-pointer hover:ring-1 hover:ring-app-accent/40"
                                />
                              </button>
                              {openStatusMenu === `${task.id}:${assignee.id}` && (
                                <div className="absolute left-0 top-full z-20 mt-1 min-w-28 rounded-lg border border-app-border bg-app-surface py-1 text-[11px] shadow-lg">
                                  {assigneeTransitions.map((status) => (
                                    <button
                                      key={status}
                                      type="button"
                                      onClick={() => {
                                        setOpenStatusMenu(null);
                                        void handleTransition(
                                          task.id,
                                          status,
                                          assignee.id,
                                        );
                                      }}
                                      className="block w-full px-3 py-1.5 text-left hover:bg-app-surface-raised"
                                    >
                                      {TRANSITION_LABELS[status] ?? status}
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
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
