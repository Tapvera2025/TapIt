import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon.js';

export interface ConfirmDiscardModalProps {
  isOpen: boolean;
  onDiscard: () => void;
  onContinue: () => void;
  title?: string | undefined;
  description?: string | undefined;
  discardText?: string | undefined;
  continueText?: string | undefined;
  zIndex?: number | undefined;
}

/**
 * Reusable modal popup to confirm abandoning unsaved work.
 *
 * Offers two explicit options:
 * - "Continue" (keeps current state / returns to editing)
 * - "Discard" (confirms cancellation and runs onDiscard)
 * Also includes top-right cross button and backdrop click to safely continue.
 */
export function ConfirmDiscardModal({
  isOpen,
  onDiscard,
  onContinue,
  title = 'Discard unsaved changes?',
  description = 'Are you sure you want to discard your changes? Any unsaved progress will be lost.',
  discardText = 'Discard',
  continueText = 'Continue',
  zIndex = 99999,
}: ConfirmDiscardModalProps): React.JSX.Element | null {
  const continueButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    // Auto-focus the Continue button so accidental Enter presses don't discard
    continueButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onContinue();
      }
    };

    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true });
    };
  }, [isOpen, onContinue]);

  if (!isOpen || typeof document === 'undefined') return null;

  return createPortal(
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="confirm-discard-title"
      aria-describedby="confirm-discard-desc"
      className="fixed inset-0 !z-[99999] flex items-center justify-center p-4"
      style={{ zIndex }}
    >
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm transition-opacity"
        onClick={onContinue}
        aria-hidden="true"
      />

      {/* Modal Card */}
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative z-10 w-full max-w-md overflow-hidden rounded-2xl border border-app-border bg-app-surface p-6 shadow-2xl text-app-foreground animate-in fade-in zoom-in-95 duration-150"
      >
        {/* Top-right close/cross button (dismisses confirmation & continues editing) */}
        <button
          type="button"
          onClick={onContinue}
          aria-label="Close dialog"
          className="absolute right-4 top-4 grid size-8 place-items-center rounded-lg text-lg text-app-muted hover:bg-app-surface-raised hover:text-app-foreground transition-colors"
        >
          ×
        </button>

        <div className="flex items-start gap-4 pr-6">
          <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-red-500/10 text-red-500 ring-1 ring-inset ring-red-500/20">
            <Icon name="alert-circle" className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 id="confirm-discard-title" className="font-display text-base font-bold text-app-foreground sm:text-lg">
              {title}
            </h3>
            <p id="confirm-discard-desc" className="mt-1.5 text-xs sm:text-sm text-app-muted leading-relaxed">
              {description}
            </p>
          </div>
        </div>

        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            ref={continueButtonRef}
            type="button"
            onClick={onContinue}
            className="rounded-lg border border-app-border bg-app-surface px-4 py-2 text-sm font-semibold text-app-foreground shadow-sm transition hover:bg-app-surface-raised hover:border-app-accent focus-visible:outline-2 focus-visible:outline-app-accent"
          >
            {continueText}
          </button>
          <button
            type="button"
            onClick={onDiscard}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-red-500 focus-visible:outline-2 focus-visible:outline-red-500"
          >
            {discardText}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

export interface ConfirmCancelButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  onDiscard: () => void;
  title?: string | undefined;
  description?: string | undefined;
  discardText?: string | undefined;
  continueText?: string | undefined;
  /** Whether there are changes to confirm. If false, calls onDiscard immediately without popup. Defaults to true. */
  needsConfirmation?: boolean | undefined;
  zIndex?: number | undefined;
  children?: ReactNode | undefined;
}

/**
 * Drop-in cancel/close button that automatically presents a confirmation popup
 * with "Discard" and "Continue" before calling `onDiscard`.
 *
 * Can be dropped into any form, modal, drawer, or editor cancel/close button.
 */
export function ConfirmCancelButton({
  children = 'Cancel',
  onDiscard,
  title,
  description,
  discardText,
  continueText,
  needsConfirmation = true,
  zIndex,
  onClick,
  type = 'button',
  ...props
}: ConfirmCancelButtonProps): React.JSX.Element {
  const [showModal, setShowModal] = useState(false);

  return (
    <>
      <button
        type={type}
        {...props}
        onClick={(e) => {
          onClick?.(e);
          if (e.defaultPrevented) return;
          if (needsConfirmation) {
            setShowModal(true);
          } else {
            onDiscard();
          }
        }}
      >
        {children}
      </button>

      <ConfirmDiscardModal
        isOpen={showModal}
        onDiscard={() => {
          setShowModal(false);
          onDiscard();
        }}
        onContinue={() => setShowModal(false)}
        title={title}
        description={description}
        discardText={discardText}
        continueText={continueText}
        zIndex={zIndex}
      />
    </>
  );
}

export const CancelButton = ConfirmCancelButton;
