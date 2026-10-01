import type { ReactNode } from 'react';

export interface TodoSectionProps {
  readonly title: string;
  readonly count: number;
  readonly emptyMessage: string;
  readonly children?: ReactNode;
}

export function TodoSection({
  title,
  count,
  emptyMessage,
  children,
}: TodoSectionProps): React.JSX.Element {
  return (
    <section className="space-y-2 min-w-0 max-w-full" aria-labelledby={`todo-section-${title.toLowerCase()}`}>
      <div className="flex items-center justify-between pb-0.5 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <h2
            id={`todo-section-${title.toLowerCase()}`}
            className="font-display text-sm sm:text-base font-bold text-app-foreground"
          >
            {title}
          </h2>
          <span className="shrink-0 rounded-full bg-app-accent/15 px-2 py-0.5 text-xs font-bold text-app-accent">
            {count}
          </span>
        </div>
      </div>

      {count === 0 ? (
        <div className="rounded-xl border border-dashed border-app-border bg-app-surface/40 p-4 sm:p-5 text-center text-xs sm:text-sm text-app-muted">
          {emptyMessage}
        </div>
      ) : (
        <div className="space-y-1.5 sm:space-y-2 min-w-0 max-w-full">{children}</div>
      )}
    </section>
  );
}
