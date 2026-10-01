import { Button, Modal, Notice } from '../../../ui/components.js';
import type { MyNotepadHistoryItem } from '../types/index.js';

export interface NoteHistoryModalProps {
  readonly isOpen: boolean;
  readonly history: MyNotepadHistoryItem[];
  readonly loading: boolean;
  readonly error: string | null;
  readonly onSelect: (item: MyNotepadHistoryItem) => void;
  readonly onRetry?: () => void;
  readonly onClose: () => void;
}

export function formatHistoryTimestamp(dateStr: string): string {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${day}/${month}/${year} ${hours}:${minutes}`;
}

export function NoteHistoryModal({
  isOpen,
  history,
  loading,
  error,
  onSelect,
  onRetry,
  onClose,
}: NoteHistoryModalProps): React.JSX.Element | null {
  if (!isOpen) return null;

  return (
    <Modal title="Note History" onClose={onClose}>
      <div className="space-y-4">
        {error && (
          <div className="space-y-2">
            <Notice error>{error}</Notice>
            {onRetry && (
              <Button
                type="button"
                kind="secondary"
                onClick={onRetry}
                className="w-full text-xs"
              >
                Retry loading history
              </Button>
            )}
          </div>
        )}

        {loading && (
          <div className="space-y-3 py-4 text-center">
            <div className="inline-block size-6 animate-spin rounded-full border-2 border-app-accent border-t-transparent" />
            <p className="text-xs text-app-muted">Loading history snapshots...</p>
          </div>
        )}

        {!loading && !error && history.length === 0 && (
          <div className="rounded-xl border border-app-border bg-app-surface-raised p-8 text-center">
            <p className="text-sm font-medium text-app-muted">
              No saved notes yet
            </p>
            <p className="mt-1 text-xs text-app-muted/70">
              When you save your note, revision snapshots will be recorded here.
            </p>
          </div>
        )}

        {!loading && !error && history.length > 0 && (
          <div className="max-h-[60vh] space-y-2.5 overflow-y-auto pr-1">
            {history.map((item) => {
              const previewText = item.content.trim() || '(Empty note)';
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSelect(item)}
                  className="w-full rounded-xl border border-app-border bg-app-surface p-3.5 text-left transition-all hover:border-app-accent hover:bg-app-surface-raised focus:border-app-accent focus:outline-none"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-app-foreground">
                      {formatHistoryTimestamp(item.createdAt)}
                    </span>
                    <span className="text-[11px] font-semibold text-app-accent">
                      View snapshot &rarr;
                    </span>
                  </div>
                  <p className="mt-1.5 line-clamp-2 text-xs text-app-muted leading-relaxed">
                    {previewText}
                  </p>
                </button>
              );
            })}
          </div>
        )}

        <div className="flex justify-end pt-2">
          <Button type="button" kind="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </Modal>
  );
}
