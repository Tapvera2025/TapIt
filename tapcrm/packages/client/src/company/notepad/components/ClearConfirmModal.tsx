import { Button, Modal } from '../../../ui/components.js';

export interface ClearConfirmModalProps {
  readonly isOpen: boolean;
  readonly isClearing?: boolean;
  readonly onConfirm: () => void;
  readonly onClose: () => void;
}

export function ClearConfirmModal({
  isOpen,
  isClearing = false,
  onConfirm,
  onClose,
}: ClearConfirmModalProps): React.JSX.Element | null {
  if (!isOpen) return null;

  return (
    <Modal title="Clear Note" onClose={onClose}>
      <p className="text-sm text-app-muted leading-relaxed">
        Are you sure you want to clear your current note? This will empty the editor, but your saved note history will remain available.
      </p>

      <div className="mt-6 flex items-center justify-end gap-3">
        <Button
          type="button"
          kind="secondary"
          onClick={onClose}
          disabled={isClearing}
        >
          Cancel
        </Button>
        <Button
          type="button"
          kind="danger"
          onClick={onConfirm}
          disabled={isClearing}
        >
          {isClearing ? 'Clearing...' : 'Clear Note'}
        </Button>
      </div>
    </Modal>
  );
}
