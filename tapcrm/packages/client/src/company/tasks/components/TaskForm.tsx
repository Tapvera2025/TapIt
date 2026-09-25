import { useEffect, useState } from 'react';
import { Button, Modal, Notice } from '../../../ui/components.js';
import type {
  CreateTaskInput,
  TaskAssignModalProps,
  TaskFormProps,
  TaskPriority,
  UpdateTaskInput,
} from '../types/index.js';
import { TaskAssigneePicker } from './TaskAssigneePicker.js';

export function TaskForm({
  isOpen,
  mode = 'create',
  initialTask,
  onSubmitCreate,
  onSubmitUpdate,
  onClose,
  disabled = false,
}: TaskFormProps): React.JSX.Element | null {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [projectId, setProjectId] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('medium');
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Initialize or reset form values when opening or when initialTask changes
  useEffect(() => {
    if (isOpen) {
      setErrorMessage(null);
      if (mode === 'edit' && initialTask) {
        setTitle(initialTask.title);
        setDescription(initialTask.description ?? '');
        setProjectId(initialTask.projectId ?? '');
        setPriority(initialTask.priority);
        setAssigneeIds(initialTask.assignees.map((a) => a.id));
        setDueDate(
          initialTask.dueDate
            ? new Date(initialTask.dueDate).toISOString().slice(0, 10)
            : '',
        );
      } else {
        setTitle('');
        setDescription('');
        setProjectId('');
        setDueDate('');
        setPriority('medium');
        setAssigneeIds([]);
      }
    }
  }, [isOpen, mode, initialTask]);

  if (!isOpen) return null;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setErrorMessage('Task title is required');
      return;
    }
    if (trimmedTitle.length > 255) {
      setErrorMessage('Task title must be 255 characters or fewer');
      return;
    }

    try {
      setSubmitting(true);
      setErrorMessage(null);

      // Convert dueDate YYYY-MM-DD to ISO date string or null
      const formattedDueDate = dueDate ? new Date(dueDate).toISOString() : null;

      if (mode === 'edit' && initialTask) {
        if (onSubmitUpdate) {
          const updateInput: UpdateTaskInput = {
            title: trimmedTitle,
            description: description.trim() || null,
            projectId: projectId.trim() || null,
            dueDate: formattedDueDate,
            priority,
          };
          await onSubmitUpdate(initialTask.id, updateInput);
        }
      } else {
        if (onSubmitCreate) {
          const createInput: CreateTaskInput = {
            title: trimmedTitle,
            description: description.trim() || null,
            projectId: projectId.trim() || null,
            assigneeIds,
            dueDate: formattedDueDate,
            priority,
          };
          await onSubmitCreate(createInput);
        }
      }

      onClose();
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'An unexpected error occurred',
      );
    } finally {
      setSubmitting(false);
    }
  }

  const isBusy = submitting || disabled;

  return (
    <Modal
      title={mode === 'edit' ? 'Edit Task' : 'Create Task'}
      onClose={onClose}
    >
      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
        {errorMessage && <Notice error>{errorMessage}</Notice>}

        {mode === 'edit' && initialTask && (
          <div className="flex flex-wrap items-center gap-1.5 border-b border-app-border/40 pb-3 text-xs text-app-muted">
            <span>Created by:</span>
            <span className="font-medium text-app-foreground">
              {initialTask.createdByName || 'Unknown'}
            </span>
            <span className="mx-1 text-app-muted/50" aria-hidden="true">→</span>
            <span>Assigned to:</span>
            <span className="font-medium text-app-foreground">
              {initialTask.assignees.length > 0
                ? initialTask.assignees.map((a) => a.fullName).join(', ')
                : 'Unassigned'}
            </span>
          </div>
        )}

        {/* Title */}
        <label className="block text-xs font-semibold text-app-muted">
          <span className="mb-1.5 block">
            Title <span className="text-app-danger">*</span>
          </span>
          <input
            type="text"
            required
            disabled={isBusy}
            maxLength={255}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What needs to be accomplished?"
            className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2 text-sm text-app-foreground outline-none focus:border-app-accent disabled:opacity-50"
          />
        </label>

        {/* Description */}
        <label className="block text-xs font-semibold text-app-muted">
          <span className="mb-1.5 block">Description</span>
          <textarea
            rows={3}
            disabled={isBusy}
            maxLength={10000}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Add relevant context, requirements, or links..."
            className="w-full resize-y rounded-lg border border-app-border bg-app-background px-3 py-2 text-sm text-app-foreground outline-none focus:border-app-accent disabled:opacity-50"
          />
        </label>

        {/* Priority & Due Date row */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {/* Priority */}
          <label className="block text-xs font-semibold text-app-muted">
            <span className="mb-1.5 block">Priority</span>
            <select
              value={priority}
              disabled={isBusy}
              onChange={(e) => setPriority(e.target.value as TaskPriority)}
              className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2 text-sm text-app-foreground outline-none focus:border-app-accent disabled:opacity-50"
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
          </label>

          {/* Schedule / Due Date */}
          <label className="block text-xs font-semibold text-app-muted">
            <span className="mb-1.5 block">Schedule / Due Date</span>
            <input
              type="date"
              disabled={isBusy}
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2 text-sm text-app-foreground outline-none focus:border-app-accent disabled:opacity-50"
            />
          </label>
        </div>

        {/* My Project (Optional) */}
        <label className="block text-xs font-semibold text-app-muted">
          <span className="mb-1.5 block">Project Association (Optional)</span>
          <input
            type="text"
            disabled={isBusy}
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            placeholder="Enter Project UUID if applicable"
            className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2 text-sm text-app-foreground outline-none focus:border-app-accent disabled:opacity-50"
          />
          <span className="mt-1 block text-[11px] text-app-muted">
            Note: No centralized Project module is currently configured in the
            workspace.
          </span>
        </label>

        {/* Multi-Assignee Picker (Create mode only; Edit uses dedicated assign endpoint) */}
        {mode === 'create' && (
          <TaskAssigneePicker
            selectedAssigneeIds={assigneeIds}
            onChange={setAssigneeIds}
            disabled={isBusy}
            projectId={projectId || undefined}
          />
        )}

        {/* Action Buttons */}
        <div className="mt-6 flex justify-end gap-3 border-t border-app-border pt-4">
          <Button
            type="button"
            kind="secondary"
            onClick={onClose}
            disabled={isBusy}
          >
            Cancel
          </Button>
          <Button type="submit" kind="primary" disabled={isBusy}>
            {submitting
              ? mode === 'edit'
                ? 'Updating...'
                : 'Creating...'
              : mode === 'edit'
                ? 'Save Changes'
                : 'Create Task'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function TaskAssignModal({
  isOpen,
  task,
  onSubmitAssign,
  onClose,
}: TaskAssignModalProps): React.JSX.Element | null {
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && task) {
      setAssigneeIds(task.assignees.map((a) => a.id));
      setErrorMessage(null);
    }
  }, [isOpen, task]);

  if (!isOpen || !task) return null;

  async function handleAssign(e: React.FormEvent) {
    e.preventDefault();
    try {
      setSubmitting(true);
      setErrorMessage(null);
      await onSubmitAssign(task!.id, assigneeIds);
      onClose();
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Failed to update assignees',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={`Manage Assignees — ${task.title}`} onClose={onClose}>
      <form onSubmit={(e) => void handleAssign(e)} className="space-y-4">
        {errorMessage && <Notice error>{errorMessage}</Notice>}

        <div className="flex flex-wrap items-center gap-1.5 border-b border-app-border/40 pb-3 text-xs text-app-muted">
          <span>Created by:</span>
          <span className="font-medium text-app-foreground">
            {task.createdByName || 'Unknown'}
          </span>
          <span className="mx-1 text-app-muted/50" aria-hidden="true">→</span>
          <span>Current Assignees:</span>
          <span className="font-medium text-app-foreground">
            {task.assignees.length > 0
              ? task.assignees.map((a) => a.fullName).join(', ')
              : 'Unassigned'}
          </span>
        </div>

        <TaskAssigneePicker
          selectedAssigneeIds={assigneeIds}
          onChange={setAssigneeIds}
          disabled={submitting}
          projectId={task.projectId || undefined}
        />

        <div className="mt-6 flex justify-end gap-3 border-t border-app-border pt-4">
          <Button
            type="button"
            kind="secondary"
            onClick={onClose}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button type="submit" kind="primary" disabled={submitting}>
            {submitting ? 'Updating...' : 'Save Assignees'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
