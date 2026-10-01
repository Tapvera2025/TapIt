import { useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';
import { Button } from '../../../ui/components.js';
import { TodoModal } from './TodoModal.js';
import type {
  CreateTodoPayload,
  MyTodo,
  TodoPriority,
  UpdateTodoPayload,
} from '../types/index.js';

export interface AddTodoModalProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onSubmit: (data: CreateTodoPayload | UpdateTodoPayload) => Promise<void>;
  readonly initialTodo?: MyTodo | null;
  readonly isSubmitting?: boolean;
}

function getTodayString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function AddTodoModal({
  isOpen,
  onClose,
  onSubmit,
  initialTodo = null,
  isSubmitting = false,
}: AddTodoModalProps): React.JSX.Element | null {
  const isEditing = Boolean(initialTodo);

  const [title, setTitle] = useState(initialTodo?.title ?? '');
  const [description, setDescription] = useState(initialTodo?.description ?? '');
  const [priority, setPriority] = useState<TodoPriority>(
    initialTodo?.priority ?? 'medium',
  );
  const [scheduledDate, setScheduledDate] = useState(
    initialTodo?.scheduledDate ?? getTodayString(),
  );
  const [dueTime, setDueTime] = useState(
    initialTodo?.dueTime ? initialTodo.dueTime.slice(0, 5) : '',
  );
  const [validationError, setValidationError] = useState<string | null>(null);

  // Sync state when modal opens or initialTodo changes
  useEffect(() => {
    if (isOpen) {
      if (initialTodo) {
        setTitle(initialTodo.title);
        setDescription(initialTodo.description ?? '');
        setPriority(initialTodo.priority);
        setScheduledDate(initialTodo.scheduledDate ?? getTodayString());
        setDueTime(initialTodo.dueTime ? initialTodo.dueTime.slice(0, 5) : '');
      } else {
        setTitle('');
        setDescription('');
        setPriority('medium');
        setScheduledDate(getTodayString());
        setDueTime('');
      }
      setValidationError(null);
    }
  }, [isOpen, initialTodo]);

  if (!isOpen) return null;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setValidationError('Title is required');
      return;
    }

    if (trimmedTitle.length > 500) {
      const errorMsg = 'Title must not exceed 500 characters';
      setValidationError(errorMsg);
      toast.error(errorMsg);
      return;
    }

    if (!scheduledDate) {
      setValidationError('Scheduled date is required');
      return;
    }

    const trimmedDesc = description.trim();
    if (trimmedDesc.length > 5000) {
      const errorMsg = 'Description must not exceed 5000 characters';
      setValidationError(errorMsg);
      toast.error(errorMsg);
      return;
    }

    setValidationError(null);

    const payload: CreateTodoPayload | UpdateTodoPayload = {
      title: trimmedTitle,
      description: trimmedDesc || null,
      priority,
      scheduledDate,
      dueTime: dueTime ? `${dueTime}:00` : null,
    };

    await onSubmit(payload);
  }

  return (
    <TodoModal
      title={isEditing ? 'Edit Todo' : 'Add New Todo'}
      onClose={onClose}
    >
      <form
        onSubmit={(event) => {
          void handleSubmit(event);
        }}
        className="space-y-4"
      >
        {validationError && (
          <div
            role="alert"
            className="rounded-lg border border-[#d86b6b]/30 bg-[#d86b6b]/10 p-3 text-xs text-app-danger"
          >
            {validationError}
          </div>
        )}

        {/* Title */}
        <label className="block text-xs font-semibold text-app-muted">
          <span className="mb-1.5 block">Title *</span>
          <input
            type="text"
            required
            disabled={isSubmitting}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Prepare monthly review notes"
            className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2 text-sm text-app-foreground outline-none focus:border-app-accent disabled:opacity-50"
          />
        </label>

        {/* Priority & Scheduled Date in 2 columns */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block text-xs font-semibold text-app-muted">
            <span className="mb-1.5 block">Priority</span>
            <select
              value={priority}
              disabled={isSubmitting}
              onChange={(e) => setPriority(e.target.value as TodoPriority)}
              className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2 text-sm text-app-foreground outline-none focus:border-app-accent disabled:opacity-50"
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </label>

          <label className="block text-xs font-semibold text-app-muted">
            <span className="mb-1.5 block">Scheduled Date *</span>
            <input
              type="date"
              required
              disabled={isSubmitting}
              value={scheduledDate}
              onChange={(e) => setScheduledDate(e.target.value)}
              className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2 text-sm text-app-foreground outline-none focus:border-app-accent disabled:opacity-50"
            />
          </label>
        </div>

        {/* Due Time */}
        <label className="block text-xs font-semibold text-app-muted">
          <span className="mb-1.5 block">Due Time (Optional)</span>
          <input
            type="time"
            disabled={isSubmitting}
            value={dueTime}
            onChange={(e) => setDueTime(e.target.value)}
            className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2 text-sm text-app-foreground outline-none focus:border-app-accent disabled:opacity-50"
          />
        </label>

        {/* Notes / Description */}
        <label className="block text-xs font-semibold text-app-muted">
          <span className="mb-1.5 block">Notes (Optional)</span>
          <textarea
            rows={3}
            disabled={isSubmitting}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Add any extra context or steps..."
            className="w-full resize-none rounded-lg border border-app-border bg-app-background px-3 py-2 text-sm text-app-foreground outline-none focus:border-app-accent disabled:opacity-50"
          />
        </label>

        {/* Actions */}
        <div className="flex items-center justify-end gap-3 pt-3">
          <Button
            type="button"
            kind="secondary"
            onClick={onClose}
            disabled={isSubmitting}
          >
            Cancel
          </Button>

          <Button
            type="submit"
            kind="primary"
            disabled={isSubmitting}
          >
            {isSubmitting
              ? isEditing
                ? 'Saving...'
                : 'Adding...'
              : isEditing
                ? 'Save Changes'
                : 'Add Todo'}
          </Button>
        </div>
      </form>
    </TodoModal>
  );
}
