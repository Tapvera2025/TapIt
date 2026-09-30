import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'react-hot-toast';
import { Card, Loading, Notice } from '../../../ui/components.js';
import {
  completeTodo,
  createTodo,
  deleteTodo,
  listTodos,
  reopenTodo,
  updateTodo,
} from '../api/todoApi.js';
import { AddTodoModal } from '../components/AddTodoModal.js';
import { DeleteTodoModal } from '../components/DeleteTodoModal.js';
import { TodoCard } from '../components/TodoCard.js';
import { TodoFilters } from '../components/TodoFilters.js';
import { TodoHeader } from '../components/TodoHeader.js';
import { TodoSection } from '../components/TodoSection.js';
import { TodoStats } from '../components/TodoStats.js';
import { TodoProgress } from '../components/TodoProgress.js';
import type {
  CreateTodoPayload,
  MyTodo,
  TodoFilterPriority,
  TodoSectionTab,
  UpdateTodoPayload,
} from '../types/index.js';

function getTodayString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function MyTodoPage(): React.JSX.Element {
  const [todos, setTodos] = useState<MyTodo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters & Tabs
  const [search, setSearch] = useState('');
  const [priority, setPriority] = useState<TodoFilterPriority>('all');
  const [activeTab, setActiveTab] = useState<TodoSectionTab>('all');

  // Modal & Mutation states
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingTodo, setEditingTodo] = useState<MyTodo | null>(null);
  const [deletingTodo, setDeletingTodo] = useState<MyTodo | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [mutatingId, setMutatingId] = useState<string | null>(null);

  const todayStr = useMemo(() => getTodayString(), []);

  // Fetch all user todos
  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const items = await listTodos();
      setTodos(items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load personal todos.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // Derived stats (from the complete list of todos)
  const stats = useMemo(() => {
    let completed = 0;
    let today = 0;
    let upcoming = 0;

    for (const todo of todos) {
      if (todo.status === 'completed') {
        completed += 1;
      } else if (todo.scheduledDate && todo.scheduledDate > todayStr) {
        upcoming += 1;
      } else {
        today += 1;
      }
    }

    return {
      total: todos.length,
      completed,
      today,
      upcoming,
    };
  }, [todos, todayStr]);

  // Filtered todos according to search and priority
  const filteredTodos = useMemo(() => {
    const q = search.trim().toLowerCase();

    return todos.filter((todo) => {
      // Priority filter
      if (priority !== 'all' && todo.priority !== priority) {
        return false;
      }

      // Search filter
      if (q) {
        const matchesTitle = todo.title.toLowerCase().includes(q);
        const matchesDesc = (todo.description ?? '').toLowerCase().includes(q);
        if (!matchesTitle && !matchesDesc) {
          return false;
        }
      }

      return true;
    });
  }, [todos, search, priority]);

  // Partitioned sections
  const { todaySection, upcomingSection, completedSection } = useMemo(() => {
    const todayList: MyTodo[] = [];
    const upcomingList: MyTodo[] = [];
    const completedList: MyTodo[] = [];

    for (const todo of filteredTodos) {
      if (todo.status === 'completed') {
        completedList.push(todo);
      } else if (todo.scheduledDate && todo.scheduledDate > todayStr) {
        upcomingList.push(todo);
      } else {
        todayList.push(todo);
      }
    }

    return {
      todaySection: todayList,
      upcomingSection: upcomingList,
      completedSection: completedList,
    };
  }, [filteredTodos, todayStr]);

  // Handlers
  function handleOpenAdd() {
    setEditingTodo(null);
    setIsModalOpen(true);
  }

  function handleOpenEdit(todo: MyTodo) {
    setEditingTodo(todo);
    setIsModalOpen(true);
  }

  async function handleModalSubmit(payload: CreateTodoPayload | UpdateTodoPayload) {
    const isEditing = Boolean(editingTodo);
    try {
      setIsSubmitting(true);
      setError(null);

      if (editingTodo) {
        const updated = await updateTodo(editingTodo.id, payload);
        setTodos((prev) =>
          prev.map((item) => (item.id === updated.id ? updated : item)),
        );
        toast.success('Todo updated successfully');
      } else {
        const created = await createTodo(payload as CreateTodoPayload);
        setTodos((prev) => [created, ...prev]);
        toast.success('Todo created successfully');
      }

      setIsModalOpen(false);
      setEditingTodo(null);
    } catch (err) {
      const fallback = isEditing ? 'Failed to update todo.' : 'Failed to create todo.';
      const msg = err instanceof Error && err.message ? err.message : fallback;
      setError(msg);
      toast.error(msg);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleComplete(id: string) {
    try {
      setMutatingId(id);
      setError(null);
      const updated = await completeTodo(id);
      setTodos((prev) =>
        prev.map((item) => (item.id === updated.id ? updated : item)),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to complete todo.');
    } finally {
      setMutatingId(null);
    }
  }

  async function handleReopen(id: string) {
    try {
      setMutatingId(id);
      setError(null);
      const updated = await reopenTodo(id);
      setTodos((prev) =>
        prev.map((item) => (item.id === updated.id ? updated : item)),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reopen todo.');
    } finally {
      setMutatingId(null);
    }
  }

  function handleOpenDelete(todo: MyTodo) {
    setDeletingTodo(todo);
  }

  async function handleConfirmDelete() {
    if (!deletingTodo) return;

    try {
      setIsDeleting(true);
      setMutatingId(deletingTodo.id);
      setError(null);
      await deleteTodo(deletingTodo.id);
      setTodos((prev) => prev.filter((item) => item.id !== deletingTodo.id));
      setDeletingTodo(null);
      toast.success('Todo deleted successfully');
    } catch (err) {
      const msg = err instanceof Error && err.message ? err.message : 'Failed to delete todo.';
      setError(msg);
      toast.error(msg);
    } finally {
      setIsDeleting(false);
      setMutatingId(null);
    }
  }

  return (
    <div className="p-3 sm:p-5 md:p-6 lg:p-8">
      <div className="mx-auto max-w-5xl space-y-3.5 sm:space-y-4">
        {/* Error notification banner */}
        {error && (
          <Notice error>
            <div className="flex items-center justify-between gap-2">
              <span>{error}</span>
              <button
                type="button"
                onClick={() => setError(null)}
                className="text-xs font-semibold underline hover:no-underline"
              >
                Dismiss
              </button>
            </div>
          </Notice>
        )}

        {/* Page Header */}
        <TodoHeader onAddTodo={handleOpenAdd} />

        {/* Compact statistics row: Total | Completed | Today | Upcoming | Progress */}
        <TodoStats
          totalCount={stats.total}
          completedCount={stats.completed}
          todayCount={stats.today}
          upcomingCount={stats.upcoming}
        >
          <TodoProgress
            totalCount={stats.total}
            completedCount={stats.completed}
          />
        </TodoStats>

        {/* Search & Filters */}
        <Card className="!p-2 sm:!p-2.5">
          <TodoFilters
            search={search}
            onSearchChange={setSearch}
            priority={priority}
            onPriorityChange={setPriority}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            tabCounts={{
              all: todos.length,
              today: stats.today,
              upcoming: stats.upcoming,
              completed: stats.completed,
            }}
            disabled={loading}
          />
        </Card>

        {/* Content / Loading / Sections */}
        {loading ? (
          <Loading />
        ) : (
          <div className="space-y-4 sm:space-y-5">
            {/* Today Section */}
            {(activeTab === 'all' || activeTab === 'today') && (
              <TodoSection
                title="Today"
                count={todaySection.length}
                emptyMessage="No tasks scheduled for today."
              >
                {todaySection.map((todo) => (
                  <TodoCard
                    key={todo.id}
                    todo={todo}
                    onComplete={() => void handleComplete(todo.id)}
                    onReopen={() => void handleReopen(todo.id)}
                    onEdit={handleOpenEdit}
                    onDelete={() => handleOpenDelete(todo)}
                    isMutating={mutatingId === todo.id}
                  />
                ))}
              </TodoSection>
            )}

            {/* Upcoming Section */}
            {(activeTab === 'all' || activeTab === 'upcoming') && (
              <TodoSection
                title="Upcoming"
                count={upcomingSection.length}
                emptyMessage="No upcoming tasks."
              >
                {upcomingSection.map((todo) => (
                  <TodoCard
                    key={todo.id}
                    todo={todo}
                    onComplete={() => void handleComplete(todo.id)}
                    onReopen={() => void handleReopen(todo.id)}
                    onEdit={handleOpenEdit}
                    onDelete={() => handleOpenDelete(todo)}
                    isMutating={mutatingId === todo.id}
                  />
                ))}
              </TodoSection>
            )}

            {/* Completed Section */}
            {(activeTab === 'all' || activeTab === 'completed') && (
              <TodoSection
                title="Completed"
                count={completedSection.length}
                emptyMessage="No completed tasks yet."
              >
                {completedSection.map((todo) => (
                  <TodoCard
                    key={todo.id}
                    todo={todo}
                    onComplete={() => void handleComplete(todo.id)}
                    onReopen={() => void handleReopen(todo.id)}
                    onEdit={handleOpenEdit}
                    onDelete={() => handleOpenDelete(todo)}
                    isMutating={mutatingId === todo.id}
                  />
                ))}
              </TodoSection>
            )}
          </div>
        )}

        {/* Add / Edit Todo Modal */}
        <AddTodoModal
          isOpen={isModalOpen}
          onClose={() => {
            setIsModalOpen(false);
            setEditingTodo(null);
          }}
          onSubmit={handleModalSubmit}
          initialTodo={editingTodo}
          isSubmitting={isSubmitting}
        />

        {/* Delete Confirmation Modal */}
        <DeleteTodoModal
          isOpen={Boolean(deletingTodo)}
          onClose={() => {
            if (!isDeleting) {
              setDeletingTodo(null);
            }
          }}
          onConfirm={() => void handleConfirmDelete()}
          todoTitle={deletingTodo?.title}
          isDeleting={isDeleting}
        />
      </div>
    </div>
  );
}
