import { useEffect, useState } from 'react';
import { Card, Icon } from '../../../ui/index.js';
import { ErrorToast } from '../../../ui/ErrorToast.js';
import { organizationToday } from '../../organizationDate.js';
import { completeTodo, createTodo, listTodos } from '../../todo/api/todoApi.js';
import { AddTodoModal } from '../../todo/components/AddTodoModal.js';
import type { CreateTodoPayload, MyTodo, TodoPriority } from '../../todo/types/index.js';
import { OverviewHeading, OverviewLink } from './SalesOverviewMetrics.js';

const priorityColors: Record<TodoPriority, string> = {
  high: 'text-app-danger',
  medium: 'text-app-accent',
  low: 'text-amber-600 dark:text-amber-400',
};

function todoDateLabel(date: string, today: string): string {
  const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' });
  if (date === today) return 'Today';
  if (Date.parse(date) - Date.parse(today) === 86_400_000) return 'Tomorrow';
  return dateFormat.format(new Date(date));
}

export function SalesOverviewTodos({ timezone, onNavigate }: {
  timezone: string;
  onNavigate: (path: string) => void;
}): React.JSX.Element {
  const [todos, setTodos] = useState<MyTodo[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [completing, setCompleting] = useState<string | null>(null);
  const today = organizationToday(timezone);

  useEffect(() => {
    let active = true;
    listTodos({ status: 'pending' })
      .then((items) => { if (active) setTodos(items); })
      .catch((cause: unknown) => { if (active) setLoadError(cause instanceof Error ? cause.message : 'Unable to load your To Do list.'); });
    return () => { active = false; };
  }, []);

  function openForm() {
    setError(null);
    setAdding(true);
  }

  async function addTodo(payload: CreateTodoPayload) {
    setSubmitting(true);
    setError(null);
    try {
      const created = await createTodo(payload);
      setTodos((items) => [created, ...(items ?? [])]);
      setAdding(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to add task.');
    } finally {
      setSubmitting(false);
    }
  }

  async function markComplete(todo: MyTodo) {
    setCompleting(todo.id);
    setError(null);
    try {
      await completeTodo(todo.id);
      setTodos((items) => items?.filter((item) => item.id !== todo.id) ?? null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to complete task.');
    } finally {
      setCompleting(null);
    }
  }

  const ordered = (todos ?? []).slice().sort((first, second) => (
    (first.scheduledDate ?? '9999').localeCompare(second.scheduledDate ?? '9999') ||
    (first.dueTime ?? '').localeCompare(second.dueTime ?? '')
  ));

  return (
    <Card className="sales-overview-card">
      <OverviewHeading title="To Do List" info="Pending items from your personal My Todo list." action={<OverviewLink onClick={() => onNavigate('/company/my-todo')}>View all</OverviewLink>} />
      {loadError && <ErrorToast message={loadError} />}
      {error && !adding && <ErrorToast message={error} />}
      <button type="button" className="sales-overview-add-todo" onClick={openForm} disabled={!todos && !loadError}>
        <Icon name="plus" className="size-5 text-app-accent" />
        Add new task to do…
      </button>
      {!todos && !loadError && <p role="status" className="sales-overview-list-state">Loading tasks…</p>}
      {todos?.length === 0 && <p className="sales-overview-list-state">No pending tasks.</p>}
      <ul className="sales-overview-todos">
        {ordered.slice(0, 5).map((todo) => (
          <li key={todo.id}>
            <button
              className="sales-overview-checkbox"
              type="button"
              disabled={completing !== null}
              aria-label={`Complete task: ${todo.title}`}
              onClick={() => void markComplete(todo)}
            />
            <div className="min-w-0">
              <p className="font-semibold">{todo.title}</p>
              {todo.description && <p className="mt-0.5 text-sm text-app-muted">{todo.description}</p>}
              {(todo.scheduledDate || todo.dueTime) && (
                <p className={`mt-1.5 flex items-center gap-1.5 text-xs font-medium ${todo.scheduledDate && todo.scheduledDate <= today ? 'text-app-danger' : 'text-app-muted'}`}>
                  <Icon name="calendar" className="size-3.5" />
                  {[todo.scheduledDate && todoDateLabel(todo.scheduledDate, today), todo.dueTime?.slice(0, 5)].filter(Boolean).join(' · ')}
                </p>
              )}
            </div>
            <span title={`${todo.priority} priority`} aria-label={`${todo.priority} priority`} role="img">
              <Icon name="flag" className={`size-4 ${priorityColors[todo.priority]}`} filled />
            </span>
          </li>
        ))}
      </ul>
      <AddTodoModal
        isOpen={adding}
        onClose={() => { if (!submitting) { setAdding(false); setError(null); } }}
        onSubmit={async (payload) => { if (payload.title) await addTodo({ ...payload, title: payload.title }); }}
        isSubmitting={submitting}
        submitError={error ?? undefined}
      />
    </Card>
  );
}
