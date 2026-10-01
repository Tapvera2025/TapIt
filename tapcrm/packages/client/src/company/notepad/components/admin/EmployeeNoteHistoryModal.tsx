import { useState } from 'react';
import { Icon } from '../../../../ui/Icon.js';
import type { EmployeeNoteListItem, MyNotepadHistoryItem } from '../../types/index.js';
import { formatHistoryTimestamp } from '../NoteHistoryModal.js';

export function EmployeeNoteHistoryModal({
  employee,
  history,
  loading,
  error,
  onClose,
}: {
  employee: EmployeeNoteListItem;
  history: readonly MyNotepadHistoryItem[];
  loading: boolean;
  error: string | null;
  onClose: () => void;
}): React.JSX.Element {
  const [selectedSnapshot, setSelectedSnapshot] = useState<MyNotepadHistoryItem | null>(null);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="employee-note-history-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
    >
      <div className="relative flex max-h-[90vh] w-full max-w-2xl flex-col rounded-2xl border border-app-border bg-app-surface shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-app-border p-5 md:p-6">
          <div>
            <div className="flex items-center gap-2">
              <Icon name="history" className="size-4 text-app-accent" />
              <p className="text-xs font-bold uppercase tracking-wider text-app-accent">
                Note History Archive
              </p>
            </div>
            <h2 id="employee-note-history-title" className="mt-1 font-display text-xl font-bold text-app-foreground">
              {employee.name}&apos;s Revision History
            </h2>
            <p className="mt-0.5 text-xs text-app-muted">
              Read-only immutable historical snapshots
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid size-8 place-items-center rounded-lg text-app-muted transition hover:bg-app-background hover:text-app-foreground"
            aria-label="Close history modal"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 md:p-6">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-16 text-sm text-app-muted">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-app-accent border-t-transparent mb-3" />
              Loading history snapshots…
            </div>
          ) : error ? (
            <div className="rounded-xl border border-[#d86b6b]/30 bg-[#d86b6b]/10 p-4 text-sm text-app-danger">
              {error}
            </div>
          ) : selectedSnapshot ? (
            /* Selected Snapshot View */
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setSelectedSnapshot(null)}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-app-accent hover:underline"
                >
                  ← Back to revision list
                </button>
                <span className="text-xs text-app-muted">
                  Recorded: {formatHistoryTimestamp(selectedSnapshot.createdAt)}
                </span>
              </div>

              <div className="rounded-xl border border-app-border bg-app-background p-4 sm:p-5">
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-app-muted">
                    Historical Snapshot
                  </span>
                  <span className="rounded-full border border-app-border bg-app-surface px-2.5 py-0.5 text-[11px] font-medium text-app-muted">
                    Read-Only
                  </span>
                </div>
                {selectedSnapshot.content.trim().length > 0 ? (
                  <div className="min-h-[160px] whitespace-pre-wrap font-sans text-sm leading-relaxed text-app-foreground">
                    {selectedSnapshot.content}
                  </div>
                ) : (
                  <div className="flex min-h-[120px] items-center justify-center text-sm italic text-app-muted">
                    Empty note snapshot
                  </div>
                )}
              </div>
            </div>
          ) : history.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center text-sm text-app-muted">
              <Icon name="history" className="size-8 text-app-muted/60 mb-3" />
              <p className="font-semibold text-app-foreground">No revision history found.</p>
              <p className="mt-1 text-xs">
                This employee has not generated any note revision history yet.
              </p>
            </div>
          ) : (
            /* History List */
            <div className="space-y-2.5">
              {history.map((item, index) => {
                const preview =
                  item.content.trim().length > 0
                    ? item.content.slice(0, 100).replace(/\n/g, ' ')
                    : '(Empty note)';

                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setSelectedSnapshot(item)}
                    className="flex w-full items-center justify-between rounded-xl border border-app-border bg-app-background p-4 text-left transition hover:border-app-accent hover:bg-app-accent/5"
                  >
                    <div className="min-w-0 flex-1 pr-4">
                      <div className="flex items-center gap-2">
                        <span className="rounded bg-app-surface px-1.5 py-0.5 text-[10px] font-bold text-app-muted">
                          #{history.length - index}
                        </span>
                        <span className="text-xs font-semibold text-app-foreground">
                          {formatHistoryTimestamp(item.createdAt)}
                        </span>
                      </div>
                      <p className="mt-1.5 truncate text-xs text-app-muted">
                        &ldquo;{preview}&rdquo;
                      </p>
                    </div>
                    <span className="shrink-0 text-xs font-bold text-app-accent">
                      View Snapshot →
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end border-t border-app-border bg-app-background/40 px-5 py-4 md:px-6">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-app-border bg-app-surface px-4 py-2 text-xs font-semibold text-app-muted transition hover:bg-app-background hover:text-app-foreground"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
