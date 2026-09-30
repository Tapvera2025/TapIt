import type { ReactNode } from 'react';
import { Card } from '../../../ui/components.js';
import { Icon } from '../../../ui/Icon.js';
import { TodoProgress } from './TodoProgress.js';

export interface TodoStatsProps {
  readonly totalCount: number;
  readonly completedCount: number;
  readonly todayCount: number;
  readonly upcomingCount?: number;
  readonly children?: ReactNode;
}

export function TodoStats({
  totalCount,
  completedCount,
  todayCount,
  upcomingCount = 0,
  children,
}: TodoStatsProps): React.JSX.Element {
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-5">
      {/* Total */}
      <Card className="p-2.5 sm:p-3 transition hover:border-app-accent/40 flex flex-col justify-between">
        <div className="flex items-center justify-between gap-1.5">
          <p className="text-xs font-medium text-app-muted truncate">Total Todos</p>
          <span className="grid size-6 shrink-0 place-items-center rounded-md bg-app-accent/10 text-app-accent sm:size-7">
            <Icon name="todo" className="size-3.5 sm:size-4" />
          </span>
        </div>
        <p className="mt-1 text-xl font-bold tracking-tight tabular-nums text-app-foreground sm:text-2xl">
          {totalCount}
        </p>
      </Card>

      {/* Completed */}
      <Card className="p-2.5 sm:p-3 transition hover:border-app-accent/40 flex flex-col justify-between">
        <div className="flex items-center justify-between gap-1.5">
          <p className="text-xs font-medium text-app-muted truncate">Completed</p>
          <span className="grid size-6 shrink-0 place-items-center rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 sm:size-7">
            <Icon name="check" className="size-3.5 sm:size-4" />
          </span>
        </div>
        <p className="mt-1 text-xl font-bold tracking-tight tabular-nums text-app-foreground sm:text-2xl">
          {completedCount}
        </p>
      </Card>

      {/* Today */}
      <Card className="p-2.5 sm:p-3 transition hover:border-app-accent/40 flex flex-col justify-between">
        <div className="flex items-center justify-between gap-1.5">
          <p className="text-xs font-medium text-app-muted truncate">Today</p>
          <span className="grid size-6 shrink-0 place-items-center rounded-md bg-amber-500/10 text-amber-600 dark:text-amber-400 sm:size-7">
            <Icon name="history" className="size-3.5 sm:size-4" />
          </span>
        </div>
        <p className="mt-1 text-xl font-bold tracking-tight tabular-nums text-app-foreground sm:text-2xl">
          {todayCount}
        </p>
      </Card>

      {/* Upcoming */}
      <Card className="p-2.5 sm:p-3 transition hover:border-app-accent/40 flex flex-col justify-between">
        <div className="flex items-center justify-between gap-1.5">
          <p className="text-xs font-medium text-app-muted truncate">Upcoming</p>
          <span className="grid size-6 shrink-0 place-items-center rounded-md bg-blue-500/10 text-blue-600 dark:text-blue-400 sm:size-7">
            <Icon name="calendar" className="size-3.5 sm:size-4" />
          </span>
        </div>
        <p className="mt-1 text-xl font-bold tracking-tight tabular-nums text-app-foreground sm:text-2xl">
          {upcomingCount}
        </p>
      </Card>

      {/* Progress */}
      {children ?? (
        <TodoProgress
          totalCount={totalCount}
          completedCount={completedCount}
        />
      )}
    </div>
  );
}

