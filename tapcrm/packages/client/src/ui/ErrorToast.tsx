import { Children, isValidElement, useEffect, type ReactNode } from 'react';
import toast from 'react-hot-toast';

/**
 * Errors are shown as toasts, not as red boxes inside the page.
 *
 * `<ErrorToast message={error} />` renders nothing; it shows a toast when it
 * appears and again whenever the message changes. Place it where the red box
 * used to be, usually as `{error && <ErrorToast message={error} />}`, so a new
 * failure after the error was cleared shows a fresh toast.
 *
 * The same message is never stacked twice: a second identical error updates the
 * toast that is still on screen.
 */

export interface ErrorToastAction {
  readonly label: string;
  readonly onClick: () => void;
}

const DURATION_MS = 5_000;
/** Longer when there is a button to press, e.g. "Try again". */
const DURATION_WITH_ACTION_MS = 9_000;

/** Plain text of a message: a string, an Error, or JSX text and values. */
function textOf(message: unknown): string {
  if (message === null || message === undefined || message === false || message === true) return '';
  if (typeof message === 'string') return message.trim();
  if (typeof message === 'number') return String(message);
  if (message instanceof Error) return message.message.trim();
  if (Array.isArray(message)) return message.map(textOf).join('').trim();
  if (isValidElement<{ children?: ReactNode }>(message)) {
    return Children.toArray(message.props.children).map(textOf).join('').trim();
  }
  return '';
}

/** Shows an error toast now. Usable outside React components too (e.g. in a catch). */
export function showErrorToast(message: unknown, action?: ErrorToastAction): void {
  const text = textOf(message);
  if (!text) return;
  const id = `error:${text}`;
  if (!action) {
    toast.error(text, { id, duration: DURATION_MS });
    return;
  }
  toast.error(
    (t) => (
      <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
        <span>{text}</span>
        <button
          type="button"
          className="font-bold underline underline-offset-2"
          onClick={() => {
            toast.dismiss(t.id);
            action.onClick();
          }}
        >
          {action.label}
        </button>
      </span>
    ),
    { id, duration: DURATION_WITH_ACTION_MS },
  );
}

/** Renders nothing; shows `message` as an error toast when it appears or changes. */
export function ErrorToast({
  message,
  action,
}: {
  /** A string, an Error, or JSX whose text is the message. Empty shows nothing. */
  message: unknown;
  /** An optional button in the toast, e.g. "Try again". */
  action?: ErrorToastAction | undefined;
}): null {
  const text = textOf(message);
  const label = action?.label;
  // The latest handler, without re-showing the toast when only the handler changes.
  const onClick = action?.onClick;
  useEffect(() => {
    if (!text) return;
    showErrorToast(text, label && onClick ? { label, onClick } : undefined);
    // Re-show only for a new message, not for a new click handler.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, label]);
  return null;
}
