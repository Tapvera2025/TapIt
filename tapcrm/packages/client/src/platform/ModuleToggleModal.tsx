import { useEffect } from 'react';
import type { ReactNode } from 'react';

export function ModuleToggleModal({
  companyName,
  moduleName,
  action,
  title = `Confirm ${action}`,
  eyebrow = 'Module access',
  message,
  variant = 'accent',
  actionLabel = `${action} module`,
  busy,
  onCancel,
  onConfirm,
}: {
  companyName: string;
  moduleName: string;
  action: string;
  title?: string;
  eyebrow?: string;
  message?: ReactNode;
  variant?: 'accent' | 'warning' | 'danger';
  actionLabel?: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onCancel();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [busy, onCancel]);

  const actionClass = variant === 'danger'
    ? 'bg-[#ff8d8d]'
    : variant === 'warning'
      ? 'bg-[#f5c56b]'
      : 'bg-app-accent';

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 px-5 py-6 backdrop-blur-sm"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel();
      }}
    >
      <section
        className="w-full max-w-[430px] rounded-2xl border border-app-border bg-app-surface p-6 text-app-foreground shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="module-toggle-title"
        aria-describedby="module-toggle-description"
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-app-accent">{eyebrow}</p>
            <h2 id="module-toggle-title" className="font-display text-2xl tracking-[-0.04em]">{title}</h2>
          </div>
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-app-accent/10 text-app-accent" aria-hidden="true">
            {variant === 'danger' ? '!' : action === 'Enable' ? '+' : '−'}
          </span>
        </div>
        <p id="module-toggle-description" className="text-sm leading-6 text-app-muted">
          {message ?? <>Are you sure you want to {action.toLowerCase()} <strong className="text-app-foreground">{moduleName}</strong> for <strong className="text-app-foreground">{companyName}</strong>?</>}
        </p>
        <div className="mt-6 flex justify-end gap-2.5">
          <button
            type="button"
            className="rounded-[9px] border border-app-border bg-app-background px-4 py-2.5 text-sm text-app-foreground transition hover:border-app-accent hover:text-app-accent disabled:cursor-wait disabled:opacity-55"
            onClick={onCancel}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="button"
            className={`rounded-[9px] px-4 py-2.5 text-sm font-bold text-app-on-accent transition hover:-translate-y-px hover:brightness-110 disabled:cursor-wait disabled:opacity-60 ${actionClass}`}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? action === 'Enable' ? 'Enabling...' : action === 'Disable' ? 'Disabling...' : `${action}ing...` : actionLabel}
          </button>
        </div>
      </section>
    </div>
  );
}
