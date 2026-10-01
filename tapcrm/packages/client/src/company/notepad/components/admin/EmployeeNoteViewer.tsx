import { Icon } from '../../../../ui/Icon.js';
import type { EmployeeNoteListItem, MyNotepad } from '../../types/index.js';
import { formatHistoryTimestamp } from '../NoteHistoryModal.js';

export function EmployeeNoteViewer({
  employee,
  note,
  loading,
  error,
  onViewHistory,
  onClose,
}: {
  employee: EmployeeNoteListItem;
  note: MyNotepad | null;
  loading: boolean;
  error: string | null;
  onViewHistory: () => void;
  onClose: () => void;
}): React.JSX.Element {
  const departmentAndDesignation = [employee.department, employee.designation]
    .filter(Boolean)
    .join(' · ');

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="employee-note-viewer-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
    >
      <div className="relative flex max-h-[90vh] w-full max-w-2xl flex-col rounded-2xl border border-app-border bg-app-surface shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-app-border p-5 md:p-6">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-app-accent">
              Employee Notepad · Read-Only
            </p>
            <h2 id="employee-note-viewer-title" className="mt-1 font-display text-xl font-bold text-app-foreground">
              {employee.name}
            </h2>
            <p className="mt-0.5 text-xs text-app-muted">
              {departmentAndDesignation || 'No Department'} · {employee.email}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid size-8 place-items-center rounded-lg text-app-muted transition hover:bg-app-background hover:text-app-foreground"
            aria-label="Close note viewer"
          >
            ✕
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-5 md:p-6">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-16 text-sm text-app-muted">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-app-accent border-t-transparent mb-3" />
              Loading employee note…
            </div>
          ) : error ? (
            <div className="rounded-xl border border-[#d86b6b]/30 bg-[#d86b6b]/10 p-4 text-sm text-app-danger">
              {error}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-xl border border-app-border bg-app-background p-4 sm:p-5">
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-app-muted">
                    Current Note Content
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-app-border bg-app-surface px-2.5 py-0.5 text-[11px] font-medium text-app-muted">
                    Read-Only
                  </span>
                </div>

                {note && note.content.trim().length > 0 ? (
                  <div className="min-h-[160px] whitespace-pre-wrap font-sans text-sm leading-relaxed text-app-foreground">
                    {note.content}
                  </div>
                ) : (
                  <div className="flex min-h-[140px] flex-col items-center justify-center text-center text-sm text-app-muted">
                    <p className="italic">No note content recorded yet.</p>
                    <p className="mt-1 text-xs">
                      This employee has not written or saved any content in their notepad.
                    </p>
                  </div>
                )}

                {note?.updatedAt && (
                  <div className="mt-4 border-t border-app-border pt-3 text-right text-xs text-app-muted">
                    Last updated: {formatHistoryTimestamp(note.updatedAt)}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between border-t border-app-border bg-app-background/40 px-5 py-4 md:px-6">
          <button
            type="button"
            onClick={onViewHistory}
            className="inline-flex items-center gap-2 rounded-xl border border-app-border bg-app-surface px-4 py-2 text-xs font-bold text-app-foreground transition hover:border-app-accent hover:text-app-accent"
          >
            <Icon name="history" className="size-4" />
            <span>View History</span>
          </button>

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
