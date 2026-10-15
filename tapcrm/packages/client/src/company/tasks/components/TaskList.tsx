import { useEffect, useRef, useState } from 'react';
import { Icon } from '../../../ui/Icon.js';
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

function getInitials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}

function ExpandableTaskDescription({
  taskId,
  description,
}: {
  taskId: string;
  description: string;
}): React.JSX.Element {
  const descriptionRef = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [hasMore, setHasMore] = useState(false);

  useEffect(() => {
    const element = descriptionRef.current;
    if (!element || expanded) return;

    const measure = () => setHasMore(element.scrollHeight > element.clientHeight + 1);
    measure();
    if (typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [description, expanded]);

  return (
    <div className="mt-1">
      <p
        ref={descriptionRef}
        id={`task-description-${taskId}`}
        className={`max-w-3xl break-words text-xs leading-relaxed text-app-muted sm:text-sm ${expanded ? '' : 'line-clamp-2'} lg:line-clamp-none`}
      >
        {description}
      </p>
      {hasMore && (
        <button
          type="button"
          className="mt-1 text-xs font-semibold text-app-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-accent lg:hidden"
          aria-expanded={expanded}
          aria-controls={`task-description-${taskId}`}
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? 'Less' : '… More'}
        </button>
      )}
    </div>
  );
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
  const [openAssigneeTaskId, setOpenAssigneeTaskId] = useState<string | null>(null);

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
        const statusCellColor = {
          pending: 'border-amber-500/30 bg-amber-500/10',
          in_progress: 'border-sky-500/30 bg-sky-500/10',
          completed: 'border-emerald-500/30 bg-emerald-500/10',
          cancelled: 'border-neutral-500/30 bg-neutral-500/10',
        }[task.status];
        const renderOverallStatusControl = (className = '') => (
          <div className={`relative ${className}`}>
            {availableTransitions.length === 0 ? (
              <TaskStatusBadge status={task.status} />
            ) : (
              <>
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() =>
                    setOpenStatusMenu(openStatusMenu === task.id ? null : task.id)
                  }
                  className="rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-accent disabled:opacity-50"
                  aria-label={myAssignment ? 'Change my task status' : 'Change task status'}
                >
                  <TaskStatusBadge
                    status={task.status}
                    className="cursor-pointer hover:ring-1 hover:ring-app-accent/40"
                  />
                </button>
                {openStatusMenu === task.id && (
                  <div className="absolute right-0 top-full z-20 mt-1 min-w-32 rounded-lg border border-app-border bg-app-surface py-1 text-xs shadow-lg">
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
              </>
            )}
          </div>
        );

        return (
          <article
            key={task.id}
            className="rounded-2xl border border-app-border/80 bg-app-surface p-4 shadow-sm transition-shadow hover:shadow-md sm:px-7 sm:py-6"
          >
            <div className="flex flex-col gap-3 border-b border-app-border/70 pb-4 lg:grid lg:grid-cols-[minmax(15rem,1fr)_minmax(18rem,auto)_auto] lg:items-center lg:gap-6 lg:border-0 lg:pb-0">
              <div className="min-w-0 flex-1 rounded-xl bg-app-surface-raised/40 p-3 lg:rounded-none lg:bg-transparent lg:p-0">
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-2 lg:block">
                  <div className="min-w-0">
                    <h3 className="break-words text-base font-bold leading-snug tracking-tight text-app-foreground sm:text-lg">
                      {task.title}
                    </h3>
                    {task.description && (
                      <ExpandableTaskDescription taskId={task.id} description={task.description} />
                    )}
                  </div>
                  <div className="shrink-0 lg:hidden">
                    {renderOverallStatusControl()}
                  </div>
                </div>
                {task.projectId && (
                  <p className="mt-2 hidden max-w-full truncate text-xs font-medium text-app-muted lg:block">
                    {task.projectName ?? 'Unknown project'}
                  </p>
                )}
              </div>

              <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs lg:hidden">
                <span className="inline-flex items-center gap-1.5 rounded-md border border-app-border/80 bg-app-surface-raised px-2.5 py-1">
                  <TaskPriorityBadge priority={task.priority} />
                </span>
                {task.projectId && (
                  <span className="max-w-full truncate text-xs font-medium text-app-muted">
                    {task.projectName ?? 'Unknown project'}
                  </span>
                )}
                {task.createdAt && (
                  <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-app-border/80 bg-app-surface-raised px-3 py-1.5 text-app-muted">
                    <Icon name="calendar" className="size-3.5 shrink-0" />
                    <span>Created</span>
                    <time className="font-medium text-app-foreground" dateTime={task.createdAt}>
                      {formatDate(task.createdAt)}
                    </time>
                  </span>
                )}
                {task.dueDate && (
                  <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-app-border/80 bg-app-surface-raised px-3 py-1.5 text-app-muted">
                    <Icon name="clock" className="size-3.5 shrink-0" />
                    <span>Due</span>
                    <time className="font-medium text-app-foreground" dateTime={task.dueDate}>
                      {formatDate(task.dueDate)}
                    </time>
                  </span>
                )}
              </div>

              <div className="hidden min-w-0 grid-cols-2 grid-rows-2 gap-2 text-[11px] lg:grid">
                <span className="flex h-9 w-full items-center justify-center gap-1 rounded-lg border border-app-border/80 bg-app-surface-raised px-2 py-1">
                  <TaskPriorityBadge priority={task.priority} />
                </span>
                {renderOverallStatusControl(`flex h-9 w-full items-center justify-center rounded-lg border px-2 py-1 ${statusCellColor}`)}
                {task.createdAt && (
                  <span className="flex h-9 w-full items-center justify-center gap-1 whitespace-nowrap rounded-lg border border-app-border/80 bg-app-surface-raised px-2 py-1 text-app-muted">
                    <Icon name="calendar" className="size-3 shrink-0" />
                    <span>Created</span>
                    <time className="font-medium text-app-foreground" dateTime={task.createdAt}>
                      {formatDate(task.createdAt)}
                    </time>
                  </span>
                )}
                {task.dueDate && (
                  <span className="flex h-9 w-full items-center justify-center gap-1 whitespace-nowrap rounded-lg border border-app-border/80 bg-app-surface-raised px-2 py-1 text-app-muted">
                    <Icon name="clock" className="size-3 shrink-0" />
                    <span>Due</span>
                    <time className="font-medium text-app-foreground" dateTime={task.dueDate}>
                      {formatDate(task.dueDate)}
                    </time>
                  </span>
                )}
              </div>

              <div className="hidden flex-wrap items-center gap-2 lg:flex lg:shrink-0 lg:justify-end">
                {onEditTask && (
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => onEditTask(task)}
                    className="inline-flex h-9 min-w-20 items-center justify-center gap-1.5 rounded-lg border border-app-border bg-app-surface px-3 text-xs font-medium text-app-foreground shadow-sm transition hover:bg-app-surface-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-accent disabled:opacity-50"
                    aria-label={`Edit task ${task.title}`}
                  >
                    <Icon name="pencil" className="size-3.5 text-app-muted" />
                    Edit
                  </button>
                )}
                {onAssignTask && (
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => onAssignTask(task)}
                    className="inline-flex h-9 min-w-20 items-center justify-center gap-1.5 rounded-lg border border-app-border bg-app-surface px-3 text-xs font-medium text-app-foreground shadow-sm transition hover:bg-app-surface-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-accent disabled:opacity-50"
                    aria-label={`Manage assignees for ${task.title}`}
                  >
                    <Icon name="users" className="size-3.5 text-app-muted" />
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

            <section className="mt-0 flex flex-col gap-4 px-0 border-t border-app-border/80 py-3 text-xs text-app-muted lg:mx-0 lg:mt-3 lg:flex-col lg:items-stretch lg:gap-3 lg:bg-transparent lg:px-0 lg:py-3">
              <div className="flex w-full items-center justify-between border-b border-app-border/60 pb-3 lg:shrink-0 lg:gap-2 lg:pb-3">
                <span className="text-[11px] font-medium uppercase tracking-wide text-app-muted"><span className="lg:hidden">Initiated by</span><span className="hidden lg:inline">Created by</span></span>
                <span className="inline-flex items-center gap-2">
                  <span
                    className="grid size-7 shrink-0 place-items-center rounded-full bg-app-background text-[10px] font-semibold text-app-muted ring-2 ring-app-surface"
                    aria-hidden="true"
                  >
                    {getInitials(task.createdByName || 'Unknown')}
                  </span>
                  <span className="text-sm font-semibold text-app-foreground">
                    {task.createdByName || 'Unknown'}
                  </span>
                </span>
              </div>

              <Icon name="arrow" className="hidden size-4 shrink-0 text-app-muted/60" />

              <div className="flex min-w-0 flex-col gap-2.5">
                <div className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    className="task-assignee-toggle group inline-flex min-h-9 w-full items-center justify-between rounded-lg px-2 text-left transition-none hover:bg-app-surface-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-accent"
                    aria-expanded={openAssigneeTaskId === task.id}
                    aria-controls={`task-assignees-${task.id}`}
                    onClick={() =>
                      setOpenAssigneeTaskId(openAssigneeTaskId === task.id ? null : task.id)
                    }
                  >
                    <span className="inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-app-muted group-hover:text-app-foreground">
                      Assigned to · {task.assignees.length}
                      <Icon
                        name="chevron-down"
                        className={`size-4 ${openAssigneeTaskId === task.id ? 'rotate-180' : ''}`}
                      />
                    </span>
                    {task.assignees.length > 0 && (
                      <span className="text-[11px] text-app-muted">
                        {task.assignees.filter((assignee) => assignee.status === 'completed').length} of {task.assignees.length} complete
                      </span>
                    )}
                  </button>
                </div>
                <div
                  id={`task-assignees-${task.id}`}
                  className={`${openAssigneeTaskId === task.id ? 'flex' : 'hidden'} min-w-0 flex-col items-stretch gap-2.5`}
                >
                  {task.assignees.length === 0 ? (
                    <span className="text-xs italic text-app-muted/80">Unassigned</span>
                  ) : (
                    <>
                      {task.assignees.map((assignee) => {
                      const isSelf = currentUserId === assignee.id;
                      const assigneeTransitions =
                        VALID_TRANSITIONS[assignee.status] ?? [];
                      return (
                        <div
                          key={assignee.id}
                          className={`inline-flex w-full max-w-full flex-wrap items-center justify-between gap-2 rounded-xl border bg-app-surface px-2.5 py-2.5 text-xs shadow-sm ${
                            isSelf
                              ? 'border-app-accent/40'
                              : 'border-app-border/80'
                          }`}
                        >
                          <span className="flex min-w-0 flex-1 items-center gap-2">
                            <span
                              className="grid size-8 shrink-0 place-items-center rounded-full bg-app-surface-raised text-[10px] font-semibold text-app-muted"
                              aria-hidden="true"
                            >
                              {getInitials(assignee.fullName)}
                            </span>
                            <span className={`max-w-40 whitespace-normal break-words font-medium ${isSelf ? 'font-semibold text-app-accent' : 'text-app-foreground'}`}>
                              {assignee.fullName} {isSelf && '(You)'}
                            </span>
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
                    </>
                  )}
                </div>
              </div>
            </section>

            <footer className="mt-0 flex gap-2.5 bg-transparent pt-3 lg:hidden">
              {onEditTask && (
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => onEditTask(task)}
                  className="inline-flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-xl bg-app-surface-raised px-4 py-2.5 text-xs font-semibold text-app-foreground transition hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-accent disabled:opacity-50"
                  aria-label={`Edit task ${task.title}`}
                >
                  <Icon name="pencil" className="size-4 text-app-muted" />
                  Edit Task
                </button>
              )}
              {onAssignTask && (
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => onAssignTask(task)}
                  className="inline-flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-xl bg-app-accent px-4 py-2.5 text-xs font-semibold text-white transition hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-accent disabled:opacity-50"
                  aria-label={`Manage assignees for ${task.title}`}
                >
                  <Icon name="users" className="size-4" />
                  Assign Member
                </button>
              )}
            </footer>
          </article>
        );
      })}
    </div>
  );
}
