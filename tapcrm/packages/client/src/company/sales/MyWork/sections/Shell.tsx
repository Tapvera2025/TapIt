import type { ReactNode } from 'react';
import { Button, Icon } from '../../../../ui/index.js';
import { ErrorToast } from '../../../../ui/ErrorToast.js';

/**
 * One section of the My Work dashboard: header with count + urgency,
 * body (the caller's list), and optional secondary action.
 */
export function MyWorkSection({
  id,
  className = '',
  title,
  count,
  urgent,
  error,
  empty,
  actionLabel,
  onAction,
  children,
}: {
  /** Lets the sales guide point at this section. */
  id?: string | undefined;
  className?: string;
  title: string;
  count: number;
  urgent?: boolean;
  error?: string | null;
  empty?: string;
  actionLabel?: string;
  onAction?: () => void;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <section id={id} className={`sales-work-panel ui-card scroll-mt-6 ${className}`} aria-labelledby={`my-work-${title.toLowerCase().replace(/\s+/g, '-')}`}>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h2
          id={`my-work-${title.toLowerCase().replace(/\s+/g, '-')}`}
          className="font-display text-xl font-bold"
        >
          {title}{' '}
          <span
            className={`ml-1 rounded-full px-2 py-0.5 text-xs font-bold ${
              urgent ? 'bg-app-danger/12 text-app-danger' : 'bg-app-surface-raised text-app-muted'
            }`}
            aria-label={`${count} item${count === 1 ? '' : 's'}`}
          >
            {count}
          </span>
        </h2>
        {actionLabel && onAction && (
          <Button kind="secondary" onClick={onAction}>
            {actionLabel}
          </Button>
        )}
      </header>
      {error && <ErrorToast message={error} />}
      {count === 0 && !error ? (
        <p className="mt-3 border-t border-app-border pt-4 text-sm text-app-muted">{empty ?? 'Nothing here.'}</p>
      ) : (
        children
      )}
    </section>
  );
}

export function MyWorkRow({ icon, title, detail, action, onAction, urgent = false }: {
  icon: string;
  title: string;
  detail: ReactNode;
  action: string;
  onAction: () => void;
  urgent?: boolean;
}): React.JSX.Element {
  return (
    <li className="sales-work-row">
      <span className="sales-work-icon" data-urgent={urgent}><Icon name={icon} className="size-5" /></span>
      <div className="min-w-0">
        <p className="break-words font-semibold">{title}</p>
        <p className="mt-1 break-words text-sm text-app-muted">{detail}</p>
      </div>
      <Button kind={urgent ? 'primary' : 'secondary'} onClick={onAction}>{action}</Button>
    </li>
  );
}
