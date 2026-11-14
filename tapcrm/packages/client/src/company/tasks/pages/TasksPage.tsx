import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { toast } from 'react-hot-toast';
import { getIdentityAccessToken, identityApiBasePath } from '../../../identity/api/authApi.js';
import { Icon } from '../../../ui/Icon.js';
import { Button, Notice, WorkspacePageContainer } from '../../../ui/components.js';
import { getCompanyIdentity } from '../../api/companyApi.js';
import {
  assignTask,
  createTask,
  listTasks,
  transitionTask,
  updateTask,
} from '../api/tasksApi.js';
import { TaskFilters } from '../components/TaskFilters.js';
import { TaskAssignModal, TaskForm } from '../components/TaskForm.js';
import { TaskList } from '../components/TaskList.js';
import { TaskKanbanBoard } from '../components/TaskKanbanBoard.js';
import type {
  CreateTaskInput,
  PaginatedTasks,
  Task,
  TaskListQuery,
  TaskStatus,
  TaskViewMode,
  TaskViewScope,
  UpdateTaskInput,
} from '../types/index.js';

export interface TasksPageProps {
  readonly isSuperAdmin?: boolean | undefined;
  readonly currentUserId?: string | undefined;
  /** Pre-filters to one project — the "Task Assignment" tab on a project's detail page passes this. */
  readonly initialProjectId?: string | undefined;
}

type TaskSummaryFilter = 'all' | 'pending' | 'in_progress' | 'completed' | 'urgent' | 'overdue';
interface TaskSummaryCounts {
  readonly all: number;
  readonly pending: number;
  readonly in_progress: number;
  readonly completed: number;
  readonly urgent: number;
  readonly overdue: number;
}

export function TasksPage({
  isSuperAdmin: propIsSuperAdmin,
  currentUserId: propCurrentUserId,
  initialProjectId,
}: TasksPageProps = {}): React.JSX.Element {
  const [isSuperAdmin, setIsSuperAdmin] = useState(propIsSuperAdmin ?? false);
  const [currentUserId, setCurrentUserId] = useState<string | undefined>(
    propCurrentUserId,
  );
  const [viewScope, setViewScope] = useState<TaskViewScope>('my_tasks');
  const [viewMode, setViewMode] = useState<TaskViewMode>(() => {
    return 'kanban';
  });

  const [query, setQuery] = useState<TaskListQuery>(() => ({
    page: 1,
    pageSize: 50,
    status: 'all',
    sortBy: 'createdAt',
    sortOrder: 'desc',
    projectId: initialProjectId,
    participantId: propIsSuperAdmin && propCurrentUserId ? propCurrentUserId : undefined,
  }));
  const [data, setData] = useState<PaginatedTasks | null>(null);
  const [summaryCounts, setSummaryCounts] = useState<TaskSummaryCounts | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const taskFetchSequence = useRef(0);

  // Modal states
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [assigningTask, setAssigningTask] = useState<Task | null>(null);
  const [notification, setNotification] = useState<{
    error?: boolean;
    message: string;
  } | null>(null);

  // Resolve identity if not passed as prop
  useEffect(() => {
    if (propIsSuperAdmin !== undefined) {
      setIsSuperAdmin(propIsSuperAdmin);
      setCurrentUserId(propCurrentUserId);
      return;
    }
    let cancelled = false;
    void getCompanyIdentity()
      .then((ident) => {
        if (!cancelled) {
          setIsSuperAdmin(ident.user.accountType === 'super-admin');
          setCurrentUserId(ident.user.id);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [propIsSuperAdmin, propCurrentUserId]);

  // Synchronize participantId with viewScope when identity resolves
  useEffect(() => {
    if (isSuperAdmin && currentUserId && viewScope === 'my_tasks') {
      setQuery((prev) => {
        if (prev.participantId === currentUserId) return prev;
        return {
          ...prev,
          participantId: currentUserId,
        };
      });
    }
  }, [isSuperAdmin, currentUserId, viewScope]);

  function handleViewScopeChange(nextScope: TaskViewScope) {
    setViewScope(nextScope);
    setQuery((prev) => ({
      ...prev,
      participantId: nextScope === 'my_tasks' ? currentUserId : undefined,
      page: 1,
    }));
  }

  function handleViewModeChange(nextMode: TaskViewMode) {
    setViewMode(nextMode);
    try {
      localStorage.setItem('tapcrm:tasks-view-mode', nextMode);
    } catch (_e) { /* ignore localStorage errors */ }
    if (nextMode === 'kanban') {
      setQuery((prev) => ({
        ...prev,
        status: 'all',
        page: 1,
        pageSize: 50,
      }));
    } else {
      setQuery((prev) => ({
        ...prev,
        pageSize: 20,
      }));
    }
  }

  const fetchTasks = useCallback(
    async (overrideQuery?: TaskListQuery, options?: { silent?: boolean }) => {
      const requestSequence = ++taskFetchSequence.current;
      try {
        if (!options?.silent) setLoading(true);
        setFetchError(null);
        const result = await listTasks(overrideQuery ?? query);
        if (requestSequence === taskFetchSequence.current) setData(result);
      } catch (err) {
        if (requestSequence === taskFetchSequence.current) {
          setFetchError(
            err instanceof Error ? err.message : 'Unable to load company tasks',
          );
        }
      } finally {
        if (requestSequence === taskFetchSequence.current) setLoading(false);
      }
    },
    [query],
  );

  useEffect(() => {
    void fetchTasks();
  }, [fetchTasks]);

  useEffect(() => {
    let cancelled = false;
    const baseQuery: TaskListQuery = {
      search: query.search,
      projectId: query.projectId,
      assigneeId: query.assigneeId,
      creatorId: query.creatorId,
      participantId: query.participantId,
      status: 'all',
      priority: 'all',
      page: 1,
      pageSize: 1,
    };

    void Promise.all([
      listTasks(baseQuery),
      listTasks({ ...baseQuery, status: 'pending' }),
      listTasks({ ...baseQuery, status: 'in_progress' }),
      listTasks({ ...baseQuery, status: 'completed' }),
      listTasks({ ...baseQuery, priority: 'urgent' }),
      listTasks({ ...baseQuery, datePreset: 'overdue' }),
    ])
      .then(([allTasks, pendingTasks, inProgressTasks, completedTasks, urgentTasks, overdueTasks]) => {
        if (cancelled) return;
        setSummaryCounts({
          all: allTasks.total,
          pending: pendingTasks.total,
          in_progress: inProgressTasks.total,
          completed: completedTasks.total,
          urgent: urgentTasks.total,
          overdue: overdueTasks.total,
        });
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [
    query.search,
    query.projectId,
    query.assigneeId,
    query.creatorId,
    query.participantId,
    data?.items,
  ]);

  const fetchTasksRef = useRef(fetchTasks);
  useEffect(() => {
    fetchTasksRef.current = fetchTasks;
  }, [fetchTasks]);

  // Real-time synchronization via Socket.IO
  useEffect(() => {
    const token = getIdentityAccessToken();
    if (!token) return;

    let socket: Socket | null = io({
      path: `${identityApiBasePath()}/socket.io`,
      auth: (send) => send({ token: getIdentityAccessToken() ?? '' }),
      reconnectionDelayMax: 30_000,
    });

    socket.on('task:updated', (payload: { id?: string; task?: Task }) => {
      if (payload?.task) {
        const updatedTask = payload.task;
        setData((prev) => {
          if (!prev) return prev;
          const exists = prev.items.some((t) => t.id === updatedTask.id);
          return {
            ...prev,
            items: exists
              ? prev.items.map((t) => (t.id === updatedTask.id ? updatedTask : t))
              : prev.items,
          };
        });
      }
      void fetchTasksRef.current(undefined, { silent: true });
    });

    socket.on('task:created', (payload: { id?: string; task?: Task }) => {
      if (payload?.task) {
        const newTask = payload.task;
        setData((prev) => {
          if (!prev) return prev;
          if (prev.items.some((t) => t.id === newTask.id)) return prev;
          return {
            ...prev,
            total: prev.total + 1,
            items: [newTask, ...prev.items],
          };
        });
      }
      void fetchTasksRef.current(undefined, { silent: true });
    });

    socket.on('task:deleted', () => {
      void fetchTasksRef.current(undefined, { silent: true });
    });

    socket.on('connect', () => {
      void fetchTasksRef.current(undefined, { silent: true });
    });

    return () => {
      socket?.close();
      socket = null;
    };
  }, []);

  // Action handlers
  async function handleCreateTask(input: CreateTaskInput) {
    try {
      const createdTask = await createTask(input);
      setNotification({ message: 'Task created successfully' });

      // Immediate state update so the new task appears with zero latency
      setData((prev) => {
        if (!prev) {
          return {
            items: [createdTask],
            total: 1,
            page: 1,
            pageSize: 20,
            totalPages: 1,
          };
        }
        return {
          ...prev,
          items: [
            createdTask,
            ...prev.items.filter((item) => item.id !== createdTask.id),
          ],
          total: prev.total + 1,
        };
      });

      // Synchronize with server
      await fetchTasks(undefined, { silent: true });
    } catch (err) {
      setNotification({
        error: true,
        message: err instanceof Error ? err.message : 'Failed to create task',
      });
      throw err;
    }
  }

  async function handleUpdateTask(id: string, input: UpdateTaskInput) {
    try {
      const updated = await updateTask(id, input);
      setNotification({ message: 'Task updated successfully' });

      // Immediate state update
      setData((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          items: prev.items.map((item) => (item.id === id ? updated : item)),
        };
      });

      await fetchTasks(undefined, { silent: true });
    } catch (err) {
      setNotification({
        error: true,
        message: err instanceof Error ? err.message : 'Failed to update task',
      });
      throw err;
    }
  }

  async function handleAssignTask(id: string, assigneeIds: string[]) {
    try {
      const updated = await assignTask(id, { assigneeIds });
      setNotification({ message: 'Assignees updated successfully' });

      // Immediate state update
      setData((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          items: prev.items.map((item) => (item.id === id ? updated : item)),
        };
      });

      await fetchTasks(undefined, { silent: true });
    } catch (err) {
      setNotification({
        error: true,
        message: err instanceof Error ? err.message : 'Failed to assign task',
      });
      throw err;
    }
  }

  async function handleTransitionStatus(
    taskId: string,
    status: TaskStatus,
    userId?: string,
    options?: { suppressToast?: boolean; viaStatus?: TaskStatus },
  ) {
    const targetTask = data?.items.find((t) => t.id === taskId);
    if (status === 'cancelled' && targetTask) {
      const canCancel = isSuperAdmin || (currentUserId && targetTask.createdBy === currentUserId);
      if (!canCancel) {
        toast.error('Only a super admin or the employee who created the task can cancel it.');
        return;
      }
    }

    // Match the server's default: regular employees transition their own
    // assignment, while super admins transition the shared task status.
    const transitionUserId = userId ?? (!isSuperAdmin ? currentUserId : undefined);

    // Optimistic state update so the card stays in the destination column.
    const previousData = data;
    setData((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        items: prev.items.map((item) => {
          if (item.id !== taskId) return item;
          if (transitionUserId) {
            return {
              ...item,
              assignees: item.assignees.map((a) =>
                a.id === transitionUserId ? { ...a, status } : a,
              ),
              status: item.assignees.length <= 1 ? status : item.status,
            };
          }
          if (!isSuperAdmin) return item;
          return {
            ...item,
            status,
            assignees: item.assignees.map((a) => ({ ...a, status })),
          };
        }),
      };
    });

    try {
      const updated = await transitionTask(taskId, { status, userId, viaStatus: options?.viaStatus });
      const statusLabel =
        status === 'in_progress'
          ? 'In Progress'
          : status === 'completed'
            ? 'Completed'
            : status === 'cancelled'
              ? 'Cancelled'
              : 'Pending';
      if (!options?.suppressToast) {
        toast.success(`Task status updated to ${statusLabel}`);
      }

      // Immediate state update with server response
      setData((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          items: prev.items.map((item) => (item.id === taskId ? updated : item)),
        };
      });

      await fetchTasks(undefined, { silent: true });
    } catch (err) {
      // Revert optimistic update on rejection
      setData(previousData);
      toast.error(
        err instanceof Error ? err.message : 'Status transition was rejected by server',
      );
      throw err;
    }
  }

  function handleSummaryFilter(filter: TaskSummaryFilter) {
    setQuery((previous) => {
      const isAllActive =
        (!previous.status || previous.status === 'all') &&
        (!previous.priority || previous.priority === 'all');
      const isSelectedActive = filter === 'urgent'
        ? previous.priority === 'urgent'
        : filter === 'overdue'
          ? previous.datePreset === 'overdue' && isAllActive
        : filter === 'all'
          ? isAllActive
          : previous.status === filter && (!previous.priority || previous.priority === 'all');
      const reset = filter === 'all' || isSelectedActive;

      return {
        ...previous,
        status: reset || filter === 'urgent' || filter === 'overdue' ? 'all' : filter,
        priority: reset ? 'all' : filter === 'urgent' ? 'urgent' : 'all',
        datePreset: filter === 'overdue'
          ? reset ? 'all' : 'overdue'
          : previous.datePreset,
        startDate: filter === 'overdue' ? undefined : previous.startDate,
        endDate: filter === 'overdue' ? undefined : previous.endDate,
        page: 1,
      };
    });
  }

  // Pagination calculations
  const total = data?.total ?? 0;
  const page = data?.page ?? 1;
  const pageSize = data?.pageSize ?? 20;
  const totalPages = data?.totalPages ?? 1;
  const summary = [
    {
      id: 'all' as const,
      label: 'All tasks',
      value: summaryCounts?.all ?? 0,
      icon: 'clipboard-list',
      tone: 'text-app-foreground',
      cardTone: 'border-app-border/80 bg-app-surface/70 hover:border-app-accent/40',
      iconTone: 'bg-app-surface-raised text-app-muted',
      active: (!query.status || query.status === 'all') && (!query.priority || query.priority === 'all'),
    },
    {
      id: 'pending' as const,
      label: 'Pending',
      value: summaryCounts?.pending ?? 0,
      icon: 'clock',
      tone: 'text-amber-600 dark:text-amber-300',
      cardTone: 'border-amber-500/25 bg-amber-500/5 hover:border-amber-500/50',
      iconTone: 'bg-amber-500/10 text-amber-600 dark:text-amber-300',
      active: query.status === 'pending' && (!query.priority || query.priority === 'all'),
    },
    {
      id: 'in_progress' as const,
      label: 'In progress',
      value: summaryCounts?.in_progress ?? 0,
      icon: 'play',
      tone: 'text-sky-600 dark:text-sky-300',
      cardTone: 'border-sky-500/25 bg-sky-500/5 hover:border-sky-500/50',
      iconTone: 'bg-sky-500/10 text-sky-600 dark:text-sky-300',
      active: query.status === 'in_progress' && (!query.priority || query.priority === 'all'),
    },
    {
      id: 'completed' as const,
      label: 'Completed',
      value: summaryCounts?.completed ?? 0,
      icon: 'check',
      tone: 'text-emerald-600 dark:text-emerald-300',
      cardTone: 'border-emerald-500/25 bg-emerald-500/5 hover:border-emerald-500/50',
      iconTone: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-300',
      active: query.status === 'completed' && (!query.priority || query.priority === 'all'),
    },
    {
      id: 'urgent' as const,
      label: 'Urgent',
      value: summaryCounts?.urgent ?? 0,
      icon: 'alert-circle',
      tone: 'text-rose-600 dark:text-rose-300',
      cardTone: 'border-rose-500/30 bg-rose-500/5 hover:border-rose-500/60',
      iconTone: 'bg-rose-500/10 text-rose-600 dark:text-rose-300',
      active: query.priority === 'urgent',
    },
    {
      id: 'overdue' as const,
      label: 'Overdue',
      value: summaryCounts?.overdue ?? 0,
      icon: 'clock',
      tone: 'text-orange-600 dark:text-orange-300',
      cardTone: 'border-orange-500/30 bg-orange-500/5 hover:border-orange-500/60',
      iconTone: 'bg-orange-500/10 text-orange-600 dark:text-orange-300',
      active: query.datePreset === 'overdue' && (!query.status || query.status === 'all') && (!query.priority || query.priority === 'all'),
    },
  ];

  return (
    <WorkspacePageContainer>
      <div className="space-y-5">
        {/* Banner notification */}
        {notification && (
          <div className="relative">
            <Notice error={notification.error ?? false}>{notification.message}</Notice>
            <button
              type="button"
              onClick={() => setNotification(null)}
              className="absolute right-3 top-3 text-xs font-bold text-app-muted hover:text-app-foreground"
              aria-label="Dismiss notification"
            >
              ✕
            </button>
          </div>
        )}

        {/* Clickable task summary filters */}
        <section aria-label="Task summary filters" className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
          {summary.map((item) => (
            <button
              key={item.id}
              type="button"
              disabled={loading}
              onClick={() => handleSummaryFilter(item.id)}
              aria-pressed={Boolean(item.active)}
              className={`rounded-xl border p-3 text-left transition-[border-color,box-shadow,transform] hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-app-accent disabled:cursor-wait disabled:opacity-60 ${item.cardTone} ${item.active ? 'ring-2 ring-app-accent/20' : ''}`}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-app-muted sm:text-[11px]">
                  {item.label}
                </span>
                <span className={`grid size-8 shrink-0 place-items-center rounded-full ${item.iconTone}`}>
                  <Icon name={item.icon} className="size-4" />
                </span>
              </span>
              <span className={`mt-1 block text-xl font-semibold tracking-tight ${item.tone}`}>
                {summaryCounts ? item.value : '—'}
              </span>
            </button>
          ))}
        </section>

        {/* Filters & Search */}
        <TaskFilters
          query={query}
          onQueryChange={(nextQuery) => setQuery(nextQuery)}
          disabled={loading}
          isSuperAdmin={isSuperAdmin}
          viewScope={viewScope}
          onViewScopeChange={handleViewScopeChange}
          viewMode={viewMode}
          onViewModeChange={handleViewModeChange}
        />

        {/* Error state with retry */}
        {fetchError && (
          <div className="flex flex-col items-start gap-2">
            <Notice error>{fetchError}</Notice>
            <Button type="button" kind="secondary" onClick={() => void fetchTasks()}>
              Retry
            </Button>
          </div>
        )}

        {/* Task View: Kanban Board or List */}
        {viewMode === 'kanban' ? (
          <TaskKanbanBoard
            tasks={data?.items ?? []}
            loading={loading && !data}
            isSuperAdmin={isSuperAdmin}
            currentUserId={currentUserId}
            onTransitionStatus={handleTransitionStatus}
            onEditTask={(task) => setEditingTask(task)}
            onAssignTask={(task) => setAssigningTask(task)}
            onCreateTask={() => setIsCreateOpen(true)}
          />
        ) : (
          <TaskList
            tasks={data?.items ?? []}
            loading={loading && !data}
            isSuperAdmin={isSuperAdmin}
            currentUserId={currentUserId}
            onTransitionStatus={handleTransitionStatus}
            onEditTask={(task) => setEditingTask(task)}
            onAssignTask={(task) => setAssigningTask(task)}
            onCreateTask={() => setIsCreateOpen(true)}
          />
        )}

        {/* Pagination Footer */}
        {data && total > 0 && (
          <div className="flex items-center justify-end gap-2 pt-4">
            <Button
              type="button"
              kind="secondary"
              disabled={page <= 1 || loading}
              onClick={() => setQuery({ ...query, page: page - 1 })}
              className="py-1 px-3 text-xs"
              aria-label="Previous page"
            >
              Previous
            </Button>
            <span className="text-xs font-medium text-app-foreground">
              Page {page} of {totalPages}
            </span>
            <Button
              type="button"
              kind="secondary"
              disabled={page >= totalPages || loading}
              onClick={() => setQuery({ ...query, page: page + 1 })}
              className="py-1 px-3 text-xs"
              aria-label="Next page"
            >
              Next
            </Button>
          </div>
        )}

        {/* Create Task Modal */}
        <TaskForm
          isOpen={isCreateOpen}
          mode="create"
          onSubmitCreate={handleCreateTask}
          onClose={() => setIsCreateOpen(false)}
          defaultProjectId={initialProjectId}
          lockProjectId={Boolean(initialProjectId)}
        />

        {/* Edit Task Modal */}
        <TaskForm
          isOpen={Boolean(editingTask)}
          mode="edit"
          initialTask={editingTask}
          onSubmitUpdate={handleUpdateTask}
          onClose={() => setEditingTask(null)}
        />

        {/* Assign Modal */}
        <TaskAssignModal
          isOpen={Boolean(assigningTask)}
          task={assigningTask}
          onSubmitAssign={handleAssignTask}
          onClose={() => setAssigningTask(null)}
        />
      </div>
    </WorkspacePageContainer>
  );
}
