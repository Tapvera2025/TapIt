import { Button } from '../../../ui/components.js';
import { TodoModal } from './TodoModal.js';

export interface DeleteTodoModalProps {
  readonly isOpen: boolean;
  readonly isDeleting?: boolean | undefined;
  readonly onConfirm: () => void;
  readonly onClose: () => void;
  readonly todoTitle?: string | null | undefined;
}

export function DeleteTodoModal({
  isOpen,
  isDeleting = false,
  onConfirm,
  onClose,
  todoTitle,
}: DeleteTodoModalProps): React.JSX.Element | null {
  if (!isOpen) return null;

  return (
    <TodoModal title="Delete Todo" onClose={onClose}>
      <div className="space-y-3 min-w-0 max-w-full">
        <p className="text-sm leading-relaxed text-app-muted">
          Are you sure want to delete this todo??
        </p>
        {todoTitle && (
          <p className="rounded-lg border border-app-border bg-app-background p-3 text-sm font-medium text-app-foreground min-w-0 max-w-full break-words [overflow-wrap:anywhere]">
            {todoTitle}
          </p>
        )}
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-end gap-3 min-w-0">
        <Button
          type="button"
          kind="secondary"
          onClick={onClose}
          disabled={isDeleting}
        >
          Cancel
        </Button>
        <Button
          type="button"
          kind="danger"
          onClick={onConfirm}
          disabled={isDeleting}
        >
          {isDeleting ? 'Deleting...' : 'Delete'}
        </Button>
      </div>
    </TodoModal>
  );
}
