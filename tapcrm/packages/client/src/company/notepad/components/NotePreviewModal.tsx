import { Button, Modal } from '../../../ui/components.js';
import type { MyNotepadHistoryItem } from '../types/index.js';
import { formatHistoryTimestamp } from './NoteHistoryModal.js';

export interface NotePreviewModalProps {
  readonly item: MyNotepadHistoryItem | null;
  readonly onClose: () => void;
  readonly onBackToHistory?: () => void;
}

export function NotePreviewModal({
  item,
  onClose,
  onBackToHistory,
}: NotePreviewModalProps): React.JSX.Element | null {
  if (!item) return null;

  return (
    <Modal title="History Snapshot" onClose={onClose}>
      <div className="space-y-4">
        <div className="flex items-center justify-between border-b border-app-border/60 pb-3 text-xs text-app-muted">
          <span>Snapshot timestamp:</span>
          <span className="font-semibold text-app-foreground">
            {formatHistoryTimestamp(item.createdAt)}
          </span>
        </div>

        <div>
          <label htmlFor="history-snapshot-content" className="sr-only">
            Snapshot content (read-only)
          </label>
          <div
            id="history-snapshot-content"
            className="w-full min-h-[220px] max-h-[50vh] overflow-y-auto whitespace-pre-wrap rounded-xl border border-app-border bg-app-background p-4 text-sm leading-relaxed text-app-foreground select-text font-sans"
            tabIndex={0}
            role="region"
            aria-label="Read-only note snapshot"
          >
            {item.content || <span className="italic text-app-muted">(Empty note)</span>}
          </div>
        </div>

        <div className="flex items-center justify-between pt-2">
          {onBackToHistory ? (
            <Button
              type="button"
              kind="secondary"
              onClick={onBackToHistory}
              className="text-xs"
            >
              &larr; Back to History
            </Button>
          ) : (
            <div />
          )}

          <Button type="button" kind="primary" onClick={onClose} className="text-xs">
            Done
          </Button>
        </div>
      </div>
    </Modal>
  );
}
