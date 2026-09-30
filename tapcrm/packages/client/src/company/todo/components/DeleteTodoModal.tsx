import { Button, Modal } from '../../../ui/components.js';

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
    <Modal title="Delete Todo" onClose={onClose}>
      <div className="space-y-3">
        <p className="text-sm leading-relaxed text-app-muted">
          Are you sure want to delete this todo??
        </p>
        {todoTitle && (
          <p className="rounded-lg border border-app-border bg-app-background p-3 text-sm font-medium text-app-foreground">
            {todoTitle}
          </p>
        )}
      </div>

      <div className="mt-6 flex items-center justify-end gap-3">
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
    </Modal>
  );
}
