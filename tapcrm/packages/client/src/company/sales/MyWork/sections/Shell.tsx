import type { ReactNode } from 'react';
import { Button, Card } from '../../../../ui/components.js';

/**
 * One section of the My Work dashboard: header with count + urgency,
 * body (the caller's list), and optional secondary action.
 */
export function MyWorkSection({
  title,
  count,
  urgent,
  error,
  empty,
  actionLabel,
  onAction,
  children,
}: {
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
    <section className="mb-8" aria-labelledby={`my-work-${title.toLowerCase().replace(/\s+/g, '-')}`}>
      <header className="mb-3 flex items-center justify-between gap-3">
        <h2
          id={`my-work-${title.toLowerCase().replace(/\s+/g, '-')}`}
          className="font-display text-xl font-bold"
        >
          {title}{' '}
          <span
            className={`ml-1 rounded-full px-2 py-0.5 text-xs font-bold ${
              urgent ? 'bg-amber-500/20 text-amber-700' : 'bg-app-background text-app-muted'
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
      {error && (
        <p className="mb-3 rounded-lg bg-[#d86b6b]/10 p-3 text-sm text-app-danger" role="alert">
          {error}
        </p>
      )}
      {count === 0 && !error ? (
        <Card>
          <p className="text-sm text-app-muted">{empty ?? 'Nothing here.'}</p>
        </Card>
      ) : (
        children
      )}
    </section>
  );
}
