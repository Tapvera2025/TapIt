import { Button, Card } from '../../../ui/components.js';
import { Icon } from '../../../ui/Icon.js';

export interface TodoProgressProps {
  readonly totalCount: number;
  readonly completedCount: number;
  readonly className?: string;
  readonly onAddTodo?: (() => void) | undefined;
}

export function TodoProgress({
  totalCount,
  completedCount,
  className = '',
  onAddTodo,
}: TodoProgressProps): React.JSX.Element {
  const safeTotalCount = Math.max(0, Number.isFinite(totalCount) ? totalCount : 0);
  const safeCompletedCount = Math.max(
    0,
    Number.isFinite(completedCount) ? completedCount : 0,
  );
  const percentage =
    safeTotalCount === 0
      ? 0
      : Math.min(
          100,
          Math.max(0, Math.round((safeCompletedCount / safeTotalCount) * 100)),
        );

  return (
    <Card
      className={`flex h-full min-h-[9.5rem] w-full flex-col justify-between p-2.5 sm:p-3 transition hover:border-app-accent/40 ${className}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-baseline gap-1.5">
          <span className="text-xl font-bold tracking-tight tabular-nums text-app-foreground sm:text-2xl">
            {percentage}%
          </span>
          <span className="text-xs font-medium text-app-muted truncate">Progress</span>
        </div>
        <div className="flex items-center gap-2 self-end sm:self-start">
          {onAddTodo && (
            <Button
              type="button"
              kind="primary"
              onClick={onAddTodo}
              className="inline-flex h-9 items-center gap-2 px-3.5 text-xs font-semibold shadow-xs sm:text-sm"
              aria-label="Add new todo"
            >
              <Icon name="todo" className="size-4 stroke-[2]" />
              <span>Add Todo</span>
            </Button>
          )}
        </div>
      </div>

      <p className="mt-4 text-xs text-app-muted">
        {safeCompletedCount} of {safeTotalCount} todos completed
      </p>

      <div className="mt-3 sm:mt-4">
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
