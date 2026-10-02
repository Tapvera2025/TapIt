import { Card } from '../../../ui/components.js';

export interface TodoProgressProps {
  readonly totalCount: number;
  readonly completedCount: number;
  readonly className?: string;
}

export function TodoProgress({
  totalCount,
  completedCount,
  className = '',
}: TodoProgressProps): React.JSX.Element {
  const safeTotalCount = Math.max(0, Number.isFinite(totalCount) ? totalCount : 0);
  const safeCompletedCount = Math.max(0, Number.isFinite(completedCount) ? completedCount : 0);
  const percentage =
    safeTotalCount === 0
      ? 0
      : Math.min(100, Math.max(0, Math.round((safeCompletedCount / safeTotalCount) * 100)));

  return (
    <Card
      className={`p-2.5 sm:p-3 transition hover:border-app-accent/40 col-span-2 lg:col-span-1 flex flex-col justify-between ${className}`}
    >
      <div className="flex items-center justify-between gap-1.5">
        <div className="flex items-baseline gap-1.5 min-w-0">
          <span className="text-xl font-bold tracking-tight tabular-nums text-app-foreground sm:text-2xl">
            {percentage}%
          </span>
          <span className="text-xs font-medium text-app-muted truncate">
            Progress
          </span>
        </div>
        <span className="grid size-6 shrink-0 place-items-center rounded-md bg-app-accent/10 text-app-accent sm:size-7">
          <svg
            className="size-3.5 sm:size-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="10" />
            <circle cx="12" cy="12" r="6" />
            <circle cx="12" cy="2" />
          </svg>
        </span>
      </div>

      <div className="mt-1 sm:mt-1.5">
        <div
          role="progressbar"
          aria-label="Overall completion"
          aria-valuenow={percentage}
          aria-valuemin={0}
          aria-valuemax={100}
          className="h-1.5 w-full overflow-hidden rounded-full bg-app-border/60"
        >
          <div
            className="h-full rounded-full bg-app-accent transition-all duration-300"
            style={{ width: `${percentage}%` }}
          />
        </div>
      </div>

      <span className="sr-only">
        Overall completion - {safeCompletedCount} of {safeTotalCount} tasks completed
      </span>
    </Card>
  );
}
