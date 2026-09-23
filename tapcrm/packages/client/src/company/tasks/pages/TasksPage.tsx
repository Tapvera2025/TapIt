import { useCallback, useEffect, useState } from 'react';
import { Button, Notice, Page } from '../../../ui/components.js';
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
import type {
  CreateTaskInput,
  PaginatedTasks,
  Task,
  TaskListQuery,
  TaskStatus,
  TaskViewScope,
  UpdateTaskInput,
} from '../types/index.js';

export interface TasksPageProps {
  readonly isSuperAdmin?: boolean | undefined;
  readonly currentUserId?: string | undefined;
}

export function TasksPage({
  isSuperAdmin: propIsSuperAdmin,
  currentUserId: propCurrentUserId,
}: TasksPageProps = {}): React.JSX.Element {
  const [isSuperAdmin, setIsSuperAdmin] = useState(propIsSuperAdmin ?? false);
  const [currentUserId, setCurrentUserId] = useState<string | undefined>(
    propCurrentUserId,
  );
  const [viewScope, setViewScope] = useState<TaskViewScope>('my_tasks');

  const [query, setQuery] = useState<TaskListQuery>(() => ({
    page: 1,
    pageSize: 20,
    sortBy: 'createdAt',
    sortOrder: 'desc',
    assigneeId:
      propIsSuperAdmin && propCurrentUserId ? propCurrentUserId : undefined,
  }));
  const [data, setData] = useState<PaginatedTasks | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

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

  // Synchronize assigneeId with viewScope when identity resolves
  useEffect(() => {
    if (isSuperAdmin && currentUserId && viewScope === 'my_tasks') {
      setQuery((prev) => {
        if (prev.assigneeId === currentUserId) return prev;
        return {
          ...prev,
          assigneeId: currentUserId,
        };
      });
    }
  }, [isSuperAdmin, currentUserId, viewScope]);

  function handleViewScopeChange(nextScope: TaskViewScope) {
    setViewScope(nextScope);
    setQuery((prev) => ({
      ...prev,
      assigneeId: nextScope === 'my_tasks' ? currentUserId : undefined,
      page: 1,
    }));
  }

  const fetchTasks = useCallback(
    async (overrideQuery?: TaskListQuery) => {
      try {
        setLoading(true);
        setFetchError(null);
        const result = await listTasks(overrideQuery ?? query);
        setData(result);
      } catch (err) {
        setFetchError(
          err instanceof Error ? err.message : 'Unable to load company tasks',
        );
      } finally {
        setLoading(false);
      }
    },
    [query],
  );

  useEffect(() => {
    void fetchTasks();
  }, [fetchTasks]);

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
      await fetchTasks();
    } catch (err) {
      setNotification({
        error: true,
        message:
          err instanceof Error ? err.message : 'Failed to create task',
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

      await fetchTasks();
    } catch (err) {
      setNotification({
        error: true,
        message:
          err instanceof Error ? err.message : 'Failed to update task',
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

      await fetchTasks();
    } catch (err) {
      setNotification({
        error: true,
        message:
          err instanceof Error ? err.message : 'Failed to assign task',
      });
      throw err;
    }
  }

  async function handleTransitionStatus(taskId: string, status: TaskStatus) {
    try {
      const updated = await transitionTask(taskId, { status });
      setNotification({ message: `Task status updated to ${status}` });

      // Immediate state update
      setData((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          items: prev.items.map((item) =>
            item.id === taskId ? updated : item,
          ),
        };
      });

      await fetchTasks();
    } catch (err) {
      setNotification({
        error: true,
        message:
          err instanceof Error
            ? err.message
            : 'Status transition was rejected by server',
      });
      throw err;
    }
  }

  // Pagination calculations
  const total = data?.total ?? 0;
  const page = data?.page ?? 1;
  const pageSize = data?.pageSize ?? 20;
  const totalPages = data?.totalPages ?? 1;
  const startItem = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const endItem = Math.min(page * pageSize, total);

  return (
    <Page
      eyebrow="Overview"
      title="Tasks"
      description={
        isSuperAdmin && viewScope === 'all_employee_tasks'
          ? 'Collaborate, organize, and monitor tasks across all company departments and teams (Viewing All Employee Tasks).'
          : 'Collaborate, organize, and monitor tasks across all company departments and teams.'
      }
      action={
        <Button
          type="button"
          kind="primary"
          onClick={() => setIsCreateOpen(true)}
        >
          Create Task
        </Button>
      }
    >
      <div className="mt-6 space-y-5">
        {/* Banner notification */}
        {notification && (
          <div className="relative">
            <Notice error={notification.error ?? false}>
              {notification.message}
            </Notice>
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

        {/* Filters & Search */}
        <TaskFilters
          query={query}
          onQueryChange={(nextQuery) => setQuery(nextQuery)}
          disabled={loading}
          isSuperAdmin={isSuperAdmin}
          viewScope={viewScope}
          onViewScopeChange={handleViewScopeChange}
        />

        {/* Error state with retry */}
        {fetchError && (
          <div className="flex flex-col items-start gap-2">
            <Notice error>{fetchError}</Notice>
            <Button
              type="button"
              kind="secondary"
              onClick={() => void fetchTasks()}
            >
              Retry
            </Button>
          </div>
        )}

        {/* Task List */}
        <TaskList
          tasks={data?.items ?? []}
          loading={loading && !data}
          onTransitionStatus={handleTransitionStatus}
          onEditTask={(task) => setEditingTask(task)}
          onAssignTask={(task) => setAssigningTask(task)}
        />

        {/* Pagination Footer */}
        {data && total > 0 && (
          <div className="flex flex-col items-center justify-between gap-3 border-t border-app-border pt-4 sm:flex-row">
            <p className="text-xs text-app-muted">
              Showing{' '}
              <span className="font-semibold text-app-foreground">
                {startItem}
              </span>{' '}
              to{' '}
              <span className="font-semibold text-app-foreground">
                {endItem}
              </span>{' '}
              of{' '}
              <span className="font-semibold text-app-foreground">
                {total}
              </span>{' '}
              tasks
            </p>

            <div className="flex items-center gap-2">
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
          </div>
        )}

        {/* Create Task Modal */}
        <TaskForm
          isOpen={isCreateOpen}
          mode="create"
          onSubmitCreate={handleCreateTask}
          onClose={() => setIsCreateOpen(false)}
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
    </Page>
  );
}
