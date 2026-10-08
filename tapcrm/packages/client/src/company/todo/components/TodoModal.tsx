import { useEffect, useId, type ReactNode } from 'react';

export interface TodoModalProps {
  readonly title: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
}

export function TodoModal({
  title,
  onClose,
  children,
}: TodoModalProps): React.JSX.Element {
  const titleId = useId();

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed inset-0 z-40 flex items-center justify-center p-3 sm:p-4"
    >
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-[#080e17a6] backdrop-blur-xs transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal Dialog Card (z-50, stacked below toast z-[9999]) */}
      <dialog
        open
        aria-labelledby={titleId}
        className="ui-dialog z-50 my-auto w-[calc(100%-2rem)] sm:w-full max-w-xl p-5 sm:p-6"
      >
        <div className="flex items-center justify-between gap-4">
          <h2 id={titleId} className="font-display text-xl font-bold">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="grid size-9 place-items-center rounded-lg text-2xl text-app-muted hover:bg-app-background"
            aria-label="Close dialog"
          >
            ×
          </button>
        </div>
        <div className="mt-5">{children}</div>
      </dialog>
    </div>
  );
}
