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
    <section
      className="min-w-0 max-w-full space-y-2"
      aria-labelledby={`todo-section-${title.toLowerCase()}`}
    >
      <div className="flex min-w-0 items-center justify-between border-b border-app-border/60 pb-2">
        <div className="flex min-w-0 items-center gap-2">
          <h2
            id={`todo-section-${title.toLowerCase()}`}
            className="font-display text-sm font-bold text-app-foreground sm:text-base"
          >
            {title}
          </h2>
          <span className="shrink-0 rounded-full bg-app-background px-2 py-0.5 text-[11px] font-bold text-app-muted">
            {count}
          </span>
        </div>
      </div>

      {count === 0 ? (
        <div className="rounded-xl border border-dashed border-app-border bg-app-surface/40 px-4 py-3 text-center text-xs text-app-muted">
          {emptyMessage}
        </div>
      ) : (
        <div className="min-w-0 max-w-full space-y-1.5 sm:space-y-2">{children}</div>
      )}
    </section>
  );
}
