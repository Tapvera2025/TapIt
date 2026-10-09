import { useState } from 'react';
import { Empty, SkeletonTable } from '../../../ui/components.js';
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
  const [transitioningTaskId, setTransitioningTaskId] = useState<string | null>(
    null,
  );
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
      <Empty>No tasks found. Try adjusting your filters or create a new task.</Empty>
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
    <div className="space-y-2.5">
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
            className="rounded-lg border border-app-border bg-app-surface p-4 transition-colors hover:border-app-border/80 shadow-xs"
          >
            {/* 1. Header: Task Title on left, Status & Actions on right */}
            <div className="flex flex-col gap-2.5 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex-1 min-w-0 pr-2">
                <h3 className="font-semibold text-sm sm:text-base text-app-foreground leading-snug break-words">
                  {task.title}
                </h3>

                {/* 2. Description directly below title */}
                {task.description && (
                  <p className="mt-1.5 text-xs text-app-muted line-clamp-2 leading-relaxed">
                    {task.description}
                  </p>
                )}
              </div>

              {/* Status and Actions cluster */}
              <div className="flex flex-wrap items-center gap-1.5 shrink-0 self-start">
                {availableTransitions.length === 0 ? (
                  <TaskStatusBadge status={task.status} />
                ) : (
                  <div className="relative">
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => setOpenStatusMenu(openStatusMenu === task.id ? null : task.id)}
                      className="disabled:opacity-50"
                      aria-label={myAssignment ? 'Change my task status' : 'Change task status'}
                    >
                      <TaskStatusBadge status={task.status} className="cursor-pointer hover:ring-1 hover:ring-app-accent/40" />
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
                    className="h-7 rounded border border-app-border bg-app-surface px-2.5 text-xs font-medium text-app-foreground hover:bg-app-surface-raised hover:border-app-accent/60 transition disabled:opacity-50"
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
                    className="h-7 rounded border border-app-border bg-app-surface px-2.5 text-xs font-medium text-app-foreground hover:bg-app-surface-raised hover:border-app-accent/60 transition disabled:opacity-50"
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

            {/* 3. Metadata Row: Priority · Project · Created */}
            <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-app-muted">
              <TaskPriorityBadge priority={task.priority} />

              {task.projectId && (
                <>
                  <span className="text-app-muted/40" aria-hidden="true">·</span>
                  <span className="inline-flex items-center gap-1 text-[11px]">
                    Project: {task.projectName ?? 'Unknown'}
                  </span>
                </>
              )}

              {task.createdAt && (
                <>
                  <span className="text-app-muted/40" aria-hidden="true">·</span>
                  <span className="text-[11px]">
                    Created {formatDate(task.createdAt)}
                  </span>
                </>
              )}
            </div>

            {/* 4. Assignment Row: Created by: Rahul Roy → Assigned to: Employee A [Status], Employee B [Status] */}
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-app-border/40 pt-2.5 text-xs text-app-muted">
              <div className="flex items-center gap-1.5">
                <span className="text-app-muted">Created by:</span>
                <span className="font-medium text-app-foreground">
                  {task.createdByName || 'Unknown'}
                </span>
              </div>

              <span className="mx-1 text-app-muted/50" aria-hidden="true">→</span>

              <div className="flex flex-wrap items-center gap-2">
                <span className="text-app-muted">Assigned to:</span>
                {task.assignees.length === 0 ? (
                  <span className="italic text-app-muted/80">Unassigned</span>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    {task.assignees.map((assignee) => {
                      const isSelf = currentUserId === assignee.id;
                      const assigneeTransitions = VALID_TRANSITIONS[assignee.status] ?? [];
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
                                onClick={() => setOpenStatusMenu(openStatusMenu === `${task.id}:${assignee.id}` ? null : `${task.id}:${assignee.id}`)}
                                className="disabled:opacity-50"
                                aria-label={`Change status for ${assignee.fullName}`}
                              >
                                <TaskStatusBadge status={assignee.status} className="cursor-pointer hover:ring-1 hover:ring-app-accent/40" />
                              </button>
                              {openStatusMenu === `${task.id}:${assignee.id}` && (
                                <div className="absolute left-0 top-full z-20 mt-1 min-w-28 rounded-lg border border-app-border bg-app-surface py-1 text-[11px] shadow-lg">
                                  {assigneeTransitions.map((status) => (
                                    <button
                                      key={status}
                                      type="button"
                                      onClick={() => {
                                        setOpenStatusMenu(null);
                                        void handleTransition(task.id, status, assignee.id);
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
