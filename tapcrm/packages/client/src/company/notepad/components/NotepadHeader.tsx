import { Button } from '../../../ui/components.js';
import { Icon } from '../../../ui/Icon.js';
import type { SaveStatus } from '../types/index.js';

export interface NotepadHeaderProps {
  readonly saveStatus: SaveStatus;
  readonly onOpenHistory: () => void;
  readonly disabled?: boolean;
}

export function NotepadHeader({
  saveStatus,
  onOpenHistory,
  disabled = false,
}: NotepadHeaderProps): React.JSX.Element {
  let statusDisplay: React.JSX.Element;

  switch (saveStatus) {
    case 'loading':
      statusDisplay = (
        <span className="inline-flex items-center text-xs font-medium text-app-muted" aria-live="polite">
          Loading...
        </span>
      );
      break;
    case 'saving':
      statusDisplay = (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-app-accent" aria-live="polite">
          <span className="inline-block size-1.5 animate-ping rounded-full bg-app-accent" aria-hidden="true" />
          Saving...
        </span>
      );
      break;
    case 'unsaved':
      statusDisplay = (
        <span className="inline-flex items-center text-xs font-medium text-amber-500 dark:text-amber-400" aria-live="polite">
          ● Unsaved changes
        </span>
      );
      break;
    case 'error':
      statusDisplay = (
        <span className="inline-flex items-center text-xs font-medium text-app-danger" aria-live="polite">
          Save failed
        </span>
      );
      break;
    case 'saved':
    default:
      statusDisplay = (
        <span className="inline-flex items-center text-xs font-medium text-app-success" aria-live="polite">
          ● All changes saved
        </span>
      );
      break;
  }

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-[-0.03em] text-app-foreground md:text-3xl">
          My Notepad
        </h1>
        <div className="mt-1 flex items-center gap-2">
          {statusDisplay}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Button
          type="button"
          kind="secondary"
          onClick={onOpenHistory}
          disabled={disabled}
          className="inline-flex items-center gap-2"
          aria-label="Open note history"
        >
          <Icon name="history" className="size-4 text-app-muted" />
          <span>History</span>
        </Button>
      </div>
    </div>
  );
}
