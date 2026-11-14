import { useEffect, useRef, useState, type DragEvent } from 'react';
import { Icon } from '../../../ui/Icon.js';
import type { Task, TaskKanbanBoardProps, TaskStatus } from '../types/index.js';
import { TaskPriorityBadge } from './TaskStatusBadge.js';

const VALID_TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  pending: ['in_progress', 'completed', 'cancelled'],
  in_progress: ['completed', 'pending', 'cancelled'],
  completed: ['in_progress', 'pending'],
  cancelled: ['pending', 'in_progress'],
};

interface ColumnDef {
  readonly id: TaskStatus;
  readonly title: string;
  readonly subtitle: string;
  readonly dotColor: string;
  readonly badgeClass: string;
  readonly borderGlow: string;
  readonly dropTargetBg: string;
}

const KANBAN_COLUMNS: readonly ColumnDef[] = [
  {
    id: 'pending',
    title: 'Pending',
    subtitle: 'Waiting to start',
    dotColor: 'bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.6)]',
    badgeClass: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
    borderGlow: 'border-amber-500/60 ring-2 ring-amber-500/20',
    dropTargetBg: 'bg-amber-500/5',
  },
  {
    id: 'in_progress',
    title: 'In Progress',
    subtitle: 'Actively working',
    dotColor: 'bg-sky-500 shadow-[0_0_8px_rgba(14,165,233,0.6)]',
    badgeClass: 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300',
    borderGlow: 'border-sky-500/60 ring-2 ring-sky-500/20',
    dropTargetBg: 'bg-sky-500/5',
  },
  {
    id: 'completed',
    title: 'Completed',
    subtitle: 'Finished & verified',
    dotColor: 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]',
    badgeClass: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
    borderGlow: 'border-emerald-500/60 ring-2 ring-emerald-500/20',
    dropTargetBg: 'bg-emerald-500/5',
  },
  {
    id: 'cancelled',
    title: 'Cancelled',
    subtitle: 'Archived or dropped',
    dotColor: 'bg-neutral-400 shadow-[0_0_6px_rgba(163,163,163,0.5)]',
    badgeClass: 'border-neutral-500/30 bg-neutral-500/10 text-neutral-600 dark:text-neutral-400',
    borderGlow: 'border-neutral-500/60 ring-2 ring-neutral-500/20',
    dropTargetBg: 'bg-neutral-500/5',
  },
];

function formatDate(dateValue: string | null): string {
  if (!dateValue) return '';
  try {
    const d = new Date(dateValue);
    if (isNaN(d.getTime())) return dateValue;
    return d.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return dateValue;
  }
}

function isOverdue(dueDate: string | null, status: TaskStatus): boolean {
  if (!dueDate || status === 'completed' || status === 'cancelled') return false;
  try {
    const due = new Date(dueDate);
    const now = new Date();
    // Due before today
    return due.getTime() < now.setHours(0, 0, 0, 0);
  } catch {
    return false;
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

export function TaskKanbanBoard({
  tasks,
  loading = false,
  isSuperAdmin = false,
  currentUserId,
  onTransitionStatus,
  onEditTask,
  onAssignTask,
  onCreateTask,
}: TaskKanbanBoardProps): React.JSX.Element {
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<TaskStatus | null>(null);
  const [transitioningTaskId, setTransitioningTaskId] = useState<string | null>(null);
  const [transitioningTaskStatus, setTransitioningTaskStatus] = useState<{
    taskId: string;
    status: TaskStatus;
  } | null>(null);
  const [openCardMenuId, setOpenCardMenuId] = useState<string | null>(null);
  const [descriptionTask, setDescriptionTask] = useState<Task | null>(null);
  const [expandedTaskIds, setExpandedTaskIds] = useState<Set<string>>(() => new Set());
  const [showCancelledTasks, setShowCancelledTasks] = useState(() =>
    tasks.some((task) => task.status === 'cancelled'),
  );
  const hasInitializedCancelledView = useRef(false);

  useEffect(() => {
    if (loading || hasInitializedCancelledView.current) return;
    setShowCancelledTasks(tasks.some((task) => task.status === 'cancelled'));
    hasInitializedCancelledView.current = true;
  }, [loading, tasks]);

  useEffect(() => {
    if (!descriptionTask) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDescriptionTask(null);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [descriptionTask]);

  const canCancel = (task: Task): boolean =>
    Boolean(isSuperAdmin || (currentUserId && task.createdBy === currentUserId));

  // Group tasks by their displayed status
  const groupedTasks: Record<TaskStatus, Task[]> = {
    pending: [],
    in_progress: [],
    completed: [],
    cancelled: [],
  };

  for (const task of tasks) {
    const myAssignment = currentUserId
      ? task.assignees.find((a) => a.id === currentUserId)
      : undefined;
    const displayedStatus = transitioningTaskStatus?.taskId === task.id
      ? transitioningTaskStatus.status
      : task.status === 'completed' || task.status === 'cancelled'
        ? task.status
        : (myAssignment?.status ?? task.status);
    const targetGroup = groupedTasks[displayedStatus] ?? groupedTasks.pending;
    targetGroup.push(task);
  }

  async function handleDropTask(targetStatus: TaskStatus) {
    if (!draggedTaskId) return;
    const task = tasks.find((t) => t.id === draggedTaskId);
    setDragOverColumn(null);
    setDraggedTaskId(null);

    if (!task) return;

    if (targetStatus === 'cancelled' && !canCancel(task)) {
      return;
    }

    const myAssignment = currentUserId
      ? task.assignees.find((a) => a.id === currentUserId)
      : undefined;
    const currentStatus =
      task.status === 'completed' || task.status === 'cancelled'
        ? task.status
        : (myAssignment?.status ?? task.status);

    if (currentStatus === targetStatus) return;

    try {
      setTransitioningTaskId(task.id);
      setTransitioningTaskStatus({ taskId: task.id, status: targetStatus });
      const allowed = VALID_TRANSITIONS[currentStatus] ?? [];
      if (allowed.includes(targetStatus)) {
        await onTransitionStatus(task.id, targetStatus);
      } else {
        // Validate the same legal path in one request so realtime clients only
        // receive the final status and the card never flashes through a column.
        const canBridgeViaInProgress =
          allowed.includes('in_progress') &&
          VALID_TRANSITIONS.in_progress.includes(targetStatus);
        await onTransitionStatus(
          task.id,
          targetStatus,
          undefined,
          canBridgeViaInProgress ? { viaStatus: 'in_progress' } : undefined,
        );
      }
      if (targetStatus === 'cancelled') setShowCancelledTasks(true);
    } catch {
      // Errors handled by parent component notification
    } finally {
      setTransitioningTaskId(null);
      setTransitioningTaskStatus(null);
    }
  }

  function handleDragStart(e: DragEvent<HTMLElement>, task: Task) {
    if (e.target instanceof Element && e.target.closest('button')) {
      e.preventDefault();
      return;
    }
    e.dataTransfer.setData('text/plain', task.id);
    e.dataTransfer.effectAllowed = 'move';
    setDraggedTaskId(task.id);
  }

  function handleDragOver(e: DragEvent<HTMLElement>, colStatus: TaskStatus) {
    e.preventDefault();
    if (colStatus === 'cancelled' && draggedTaskId) {
      const task = tasks.find((t) => t.id === draggedTaskId);
      if (task && !canCancel(task)) {
        e.dataTransfer.dropEffect = 'none';
        return;
      }
    }
    e.dataTransfer.dropEffect = 'move';
    if (dragOverColumn !== colStatus) {
      setDragOverColumn(colStatus);
    }
  }

  function handleDragLeave(e: DragEvent<HTMLElement>) {
    e.preventDefault();
    // Only reset if we left the current column
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setDragOverColumn(null);
    }
  }

  function handleDragEnd() {
    setDraggedTaskId(null);
    setDragOverColumn(null);
  }

  if (loading) {
    return (
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        {[1, 2, 3, 4].map((colIndex) => (
          <div
            key={colIndex}
            className="flex flex-col gap-3 rounded-2xl border border-app-border/80 bg-app-surface/60 p-4"
          >
            <div className="flex items-center justify-between">
              <div className="h-5 w-24 animate-pulse rounded bg-app-border/70" />
              <div className="h-5 w-8 animate-pulse rounded-full bg-app-border/70" />
            </div>
            <div className="space-y-3 pt-2">
              {[1, 2, 3].map((cardIndex) => (
                <div
                  key={cardIndex}
                  className="h-28 animate-pulse rounded-xl border border-app-border/70 bg-app-surface-raised"
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div
      className={`grid grid-cols-1 gap-4 md:grid-cols-2 items-start ${
        showCancelledTasks
          ? 'lg:grid-cols-4'
          : 'lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_80px]'
      }`}
      onDragEnd={handleDragEnd}
    >
      {KANBAN_COLUMNS.map((column) => {
        const columnTasks = groupedTasks[column.id] ?? [];
        const isColumnActive = dragOverColumn === column.id;
        const isCancelledColumn = column.id === 'cancelled';
        const isCollapsedCancelledColumn = isCancelledColumn && !showCancelledTasks;

        return (
          <section
            key={column.id}
            aria-label={`${column.title} column`}
            onDragOver={(e) => handleDragOver(e, column.id)}
            onDragEnter={(e) => handleDragOver(e, column.id)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => {
              e.preventDefault();
              void handleDropTask(column.id);
            }}
            className={`relative flex flex-col rounded-2xl border bg-app-surface/60 transition-all duration-200 ${
              isCollapsedCancelledColumn
                ? 'min-h-12 w-full p-1.5 sm:p-2 lg:min-h-[380px] lg:w-20 lg:self-stretch lg:justify-start lg:border-slate-200 lg:bg-[#F8FAFC]'
                : 'min-h-[380px] p-3 sm:p-3.5'
            } ${
              isColumnActive
                ? `${column.borderGlow} ${column.dropTargetBg} shadow-md`
                : 'border-app-border/80 hover:border-app-border'
            }`}
          >
            {/* Column Header */}
            <header className={`flex items-center ${isCollapsedCancelledColumn ? 'flex-row justify-between border-b border-app-border/60 pb-2 lg:flex-col lg:gap-3 lg:border-slate-200 lg:pb-2' : 'justify-between border-b border-app-border/60 pb-3'}`}>
              <div className={`flex items-center ${isCollapsedCancelledColumn ? 'gap-2 lg:absolute lg:inset-x-0 lg:bottom-2 lg:top-14 lg:z-10 lg:flex-col lg:items-stretch lg:gap-1' : 'gap-2'}`}>
                <span className={`size-2.5 rounded-full ${column.dotColor} ${isCollapsedCancelledColumn ? 'lg:hidden' : ''}`} aria-hidden="true" />
                {isCollapsedCancelledColumn ? (
                  <button
                    type="button"
                    onClick={() => setShowCancelledTasks(true)}
                    className="text-xs font-bold uppercase tracking-wider text-app-foreground hover:text-app-accent focus-visible:outline-2 focus-visible:outline-app-accent lg:flex lg:h-full lg:w-full lg:flex-1 lg:justify-center lg:text-slate-700"
                    aria-label={`Show ${columnTasks.length} cancelled tasks`}
                    aria-expanded={false}
                  >
                    <span className="lg:hidden">{column.title}</span>
                    <span className="hidden lg:flex lg:h-full lg:flex-1 lg:flex-col lg:items-center lg:justify-between lg:py-2" aria-hidden="true">
                      {column.title.toUpperCase().split('').map((letter, index) => (
                        <span key={`${letter}-${index}`} className="text-lg font-semibold leading-none tracking-[0.12em]">{letter}</span>
                      ))}
                    </span>
                  </button>
                ) : (
                  <h3 className="text-xs font-bold uppercase tracking-wider text-app-foreground">{column.title}</h3>
                )}
              </div>
              <div className={`flex items-center ${isCollapsedCancelledColumn ? 'gap-1.5 lg:order-1' : 'gap-2'}`}>
                {!isCancelledColumn && onCreateTask && (
                  <button
                    type="button"
                    onClick={onCreateTask}
                    className="grid size-6 shrink-0 place-items-center rounded-md border border-app-border/70 bg-app-surface-raised/60 text-app-muted transition-colors hover:border-app-accent/40 hover:bg-app-accent/10 hover:text-app-accent focus-visible:outline-2 focus-visible:outline-app-accent"
                    aria-label={`Create task in ${column.title}`}
                    title={`Create task in ${column.title}`}
                  >
                    <Icon name="plus" className="size-3.5" />
                  </button>
                )}
                {isCancelledColumn && (
                  <button
                    type="button"
                    onClick={() => setShowCancelledTasks((shown) => !shown)}
                    className="grid size-7 shrink-0 place-items-center rounded-md border border-app-border/80 bg-app-surface/80 text-sm font-semibold text-app-foreground transition-colors hover:bg-app-surface-raised focus-visible:outline-2 focus-visible:outline-app-accent lg:border-slate-200 lg:bg-white lg:text-slate-600 lg:hover:bg-slate-100"
                    aria-label={isCollapsedCancelledColumn ? 'Expand cancelled tasks' : 'Collapse cancelled tasks'}
                    aria-expanded={!isCollapsedCancelledColumn}
                  >
                    <Icon
                      name={isCollapsedCancelledColumn ? 'chevron-left' : 'chevron-right'}
                      className="size-3.5"
                    />
                  </button>
                )}
              </div>
            </header>

            {/* Subtitle helper */}
            {!isCollapsedCancelledColumn && (
              <p className="pt-2 pb-1 text-[11px] text-app-muted">
                {column.subtitle}
              </p>
            )}

            {/* Task Card List / Drop Zone */}
            <div
              className={`flex-1 space-y-2.5 transition-all duration-150 ${
                isCollapsedCancelledColumn
                  ? 'min-h-0 pt-0'
                  : `min-h-[200px] pt-1 ${isColumnActive && columnTasks.length === 0 ? 'rounded-xl p-2 bg-app-accent/5' : ''}`
              }`}
            >
              {!isCollapsedCancelledColumn && columnTasks.map((task) => {
                const isDraggingThis = draggedTaskId === task.id;
                const isBusy = transitioningTaskId === task.id;
                const isTaskCollapsed = !expandedTaskIds.has(task.id);
                const overdue = isOverdue(task.dueDate, column.id);
                const hasAssignees = task.assignees.length > 0;
                const priorityLabel = task.priority.charAt(0).toUpperCase() + task.priority.slice(1);
                const priorityMarkerClass = {
                  low: 'border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200',
                  medium: 'border-sky-300 bg-sky-50 text-sky-700 dark:border-sky-700 dark:bg-sky-950/50 dark:text-sky-300',
                  high: 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-950/50 dark:text-amber-300',
                  urgent: 'border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-700 dark:bg-rose-950/50 dark:text-rose-300',
                }[task.priority];

                return (
                  <article
                    key={task.id}
                    draggable={!isBusy}
                    onDragStart={(e) => handleDragStart(e, task)}
                    className={`group relative rounded-xl border border-app-border/80 bg-app-surface p-3 shadow-xs transition-[transform,box-shadow,opacity,border-color] duration-150 cursor-grab active:cursor-grabbing ${
                      column.id === 'cancelled'
                        ? 'bg-app-surface-raised/60 opacity-60 grayscale-[0.25] hover:shadow-xs'
                        : 'hover:border-app-accent/50 hover:shadow-md'
                    } ${
                      isDraggingThis
                        ? 'opacity-40 scale-95 border-dashed border-app-accent ring-2 ring-app-accent/30'
                        : isBusy
                          ? 'opacity-60 pointer-events-none'
                          : ''
                    }`}
                  >
                    {/* Task title and card controls */}
                    <div className="flex items-start gap-1.5">
                      <h4 className={`min-w-0 flex-1 pt-1 text-xs font-semibold leading-snug text-app-foreground ${isTaskCollapsed ? 'truncate' : 'line-clamp-2'}`}>
                        {task.title}
                      </h4>

                      {isTaskCollapsed && (
                        <div className="flex shrink-0 items-center gap-1 self-center">
                          <span
                            className={`grid size-5 place-items-center rounded-md border text-[10px] font-bold leading-none ${priorityMarkerClass}`}
                            title={`Priority: ${priorityLabel}`}
                            aria-label={`Priority: ${priorityLabel}`}
                            role="img"
                          >
                            {task.priority.charAt(0).toUpperCase()}
                          </span>
                          {overdue && (
                            <span
                              className="grid size-5 place-items-center rounded-md border border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-700 dark:bg-rose-950/50 dark:text-rose-300"
                              title="Overdue"
                              aria-label="Overdue"
                              role="img"
                            >
                              <Icon name="clock" className="size-3" />
                            </span>
                          )}
                        </div>
                      )}

                      {/* Card Actions Menu */}
                      <div className="relative shrink-0">
                        <button
                          type="button"
                          onClick={() =>
                            setOpenCardMenuId((curr) => (curr === task.id ? null : task.id))
                          }
                          className="grid size-6 place-items-center rounded-lg border border-app-border bg-app-surface-raised text-app-foreground shadow-xs transition-colors hover:border-app-accent/40 hover:bg-app-accent/10 focus-visible:outline-2 focus-visible:outline-app-accent"
                          aria-label={`Actions for ${task.title}`}
                          aria-expanded={openCardMenuId === task.id}
                        >
                          <Icon name="more" className="size-4" />
                        </button>

                        {openCardMenuId === task.id && (
                          <div
                            className="absolute right-0 top-7 z-20 w-44 rounded-xl border border-app-border/80 bg-app-surface p-1 shadow-lg backdrop-blur-md"
                            onMouseLeave={() => setOpenCardMenuId(null)}
                          >
                            {onEditTask && (
                              <button
                                type="button"
                                onClick={() => {
                                  setOpenCardMenuId(null);
                                  onEditTask(task);
                                }}
                                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs font-medium text-app-foreground hover:bg-app-accent/10 hover:text-app-accent transition-colors"
                              >
                                <Icon name="edit" className="size-3.5" />
                                <span>Edit details</span>
                              </button>
                            )}
                            {onAssignTask && (
                              <button
                                type="button"
                                onClick={() => {
                                  setOpenCardMenuId(null);
                                  onAssignTask(task);
                                }}
                                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs font-medium text-app-foreground hover:bg-app-accent/10 hover:text-app-accent transition-colors"
                              >
                                <Icon name="user-plus" className="size-3.5" />
                                <span>Assign members</span>
                              </button>
                            )}

                            {/* Quick status moves */}
                            <div className="my-1 border-t border-app-border/60" />
                            <p className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-app-muted">
                              Move status to:
                            </p>
                            {KANBAN_COLUMNS.filter((col) => col.id !== column.id && (col.id !== 'cancelled' || canCancel(task))).map((col) => (
                              <button
                                key={col.id}
                                type="button"
                                onClick={() => {
                                  setOpenCardMenuId(null);
                                  void onTransitionStatus(task.id, col.id);
                                }}
                                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1 text-left text-xs text-app-foreground hover:bg-app-accent/10 hover:text-app-accent transition-colors"
                              >
                                <span className={`size-1.5 rounded-full ${col.dotColor}`} />
                                <span>{col.title}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                      <button
                        type="button"
                        draggable={false}
                        onClick={() => setExpandedTaskIds((current) => {
                          const next = new Set(current);
                          if (next.has(task.id)) next.delete(task.id);
                          else next.add(task.id);
                          return next;
                        })}
                        className="grid size-6 shrink-0 place-items-center rounded-lg border border-app-border/60 text-app-muted transition-colors hover:bg-app-surface-raised hover:text-app-foreground focus-visible:outline-2 focus-visible:outline-app-accent"
                        aria-label={`${isTaskCollapsed ? 'Expand' : 'Collapse'} details for ${task.title}`}
                        aria-expanded={!isTaskCollapsed}
                      >
                        <Icon name="chevron-down" className={`size-3.5 transition-transform ${isTaskCollapsed ? '-rotate-90' : ''}`} />
                      </button>
                    </div>

                    {/* Task Description Preview */}
                    {!isTaskCollapsed && task.description && (
                      <div className="mt-1">
                        <p className="text-[11px] leading-relaxed text-app-muted line-clamp-2">
                          {task.description}
                        </p>
                        {task.description.length > 100 && (
                          <button
                            type="button"
                            onClick={() => setDescriptionTask(task)}
                            className="mt-1 text-[10px] font-medium text-app-accent underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-app-accent focus-visible:outline-offset-2"
                            aria-haspopup="dialog"
                            aria-label={`Read full description for ${task.title}`}
                          >
                            Read full description
                          </button>
                        )}
                      </div>
                    )}

                    {/* Card Footer: Due Date, Priority & Assignees */}
                    {!isTaskCollapsed && <div className="mt-3 flex items-center justify-between gap-2 border-t border-app-border/40 pt-2.5 text-[11px]">
                      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                        {task.projectName && (
                          <span
                            className="inline-block max-w-[110px] truncate rounded-md bg-app-background/80 px-1.5 py-0.5 text-[10px] font-medium text-app-muted"
                            title={task.projectName}
                          >
                            {task.projectName}
                          </span>
                        )}
                        {task.dueDate ? (
                          <div
                            className={`inline-flex items-center gap-1 font-medium ${
                              overdue
                                ? 'text-rose-600 dark:text-rose-400 font-semibold'
                                : 'text-app-muted'
                            }`}
                            title={overdue ? 'Overdue task' : `Due on ${formatDate(task.dueDate)}`}
                          >
                            <Icon name="clock" className="size-3 shrink-0" />
                            <span>{formatDate(task.dueDate)}</span>
                            {overdue && (
                              <span className="rounded bg-rose-500/10 px-1 py-0.2 text-[9px] font-bold uppercase text-rose-600 dark:text-rose-400">
                                Overdue
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-[10px] text-app-muted/60">No due date</span>
                        )}
                        <TaskPriorityBadge
                          priority={task.priority}
                          className="rounded-md border border-current/15 bg-app-surface-raised/70 px-1.5 py-0.5 text-[10px]"
                        />
                      </div>

                      {/* Assignee Avatar Pile */}
                      {hasAssignees ? (
                        <div
                          className="flex -space-x-1.5 overflow-hidden"
                          title={`Assigned to:\n${task.assignees.map((assignee) => `${assignee.fullName} (${assignee.status.replace('_', ' ')})`).join('\n')}`}
                          aria-label={`Assigned to ${task.assignees.map((assignee) => assignee.fullName).join(', ')}`}
                        >
                          {task.assignees.slice(0, 3).map((assignee) => (
                            <span
                              key={assignee.id}
                              className="grid size-5.5 place-items-center rounded-full bg-app-accent/15 text-[9px] font-bold text-app-accent ring-1.5 ring-app-surface"
                            >
                              {getInitials(assignee.fullName)}
                            </span>
                          ))}
                          {task.assignees.length > 3 && (
                            <span
                              className="grid size-5.5 place-items-center rounded-full bg-app-surface-raised text-[8px] font-semibold text-app-muted ring-1.5 ring-app-surface"
                            >
                              +{task.assignees.length - 3}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-[10px] text-app-muted/60">Unassigned</span>
                      )}
                    </div>}
                  </article>
                );
              })}

              {/* Empty Column Drop Zone */}
              {columnTasks.length === 0 && !isCollapsedCancelledColumn && (
                <div
                  className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-6 text-center transition-colors ${
                    isColumnActive
                      ? 'border-app-accent/60 bg-app-accent/10 text-app-accent'
                      : 'border-app-border/60 text-app-muted/70'
                  }`}
                >
                  <Icon
                    name={isColumnActive ? 'plus' : 'grip'}
                    className={`size-5 mb-1.5 ${isColumnActive ? 'text-app-accent animate-bounce' : 'opacity-40'}`}
                  />
                  <p className="text-xs font-semibold">
                    {isColumnActive ? 'Drop task here' : 'No tasks'}
                  </p>
                  <p className="mt-0.5 text-[10px] opacity-70">
                    {isColumnActive
                      ? `Release to mark as ${column.title}`
                      : 'Drag cards here to update status'}
                  </p>
                </div>
              )}
            </div>
          </section>
        );
      })}
      {descriptionTask?.description && (
        <div
          className="fixed inset-0 z-[90] grid place-items-center bg-black/45 px-4 py-6 backdrop-blur-sm"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setDescriptionTask(null);
          }}
        >
          <section
            className="w-full max-w-xl overflow-hidden rounded-2xl border border-app-border bg-app-surface shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="task-description-dialog-title"
          >
            <header className="flex items-start justify-between gap-4 border-b border-app-border px-5 py-4">
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-app-muted">Task description</p>
                <h2 id="task-description-dialog-title" className="mt-1 break-words text-base font-semibold text-app-foreground">
                  {descriptionTask.title}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setDescriptionTask(null)}
                className="grid size-8 shrink-0 place-items-center rounded-lg text-lg text-app-muted hover:bg-app-surface-raised hover:text-app-foreground focus-visible:outline-2 focus-visible:outline-app-accent"
                aria-label="Close description"
                autoFocus
              >
                ×
              </button>
            </header>
            <div className="max-h-[65vh] overflow-y-auto px-5 py-4">
              <p className="whitespace-pre-wrap break-words text-sm leading-6 text-app-foreground">
                {descriptionTask.description}
              </p>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
