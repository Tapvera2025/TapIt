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
  readonly onAddTodo?: (() => void) | undefined;
}

export function TodoStats({
  totalCount,
  completedCount,
  todayCount,
  upcomingCount = 0,
  children,
  onAddTodo,
}: TodoStatsProps): React.JSX.Element {
  return (
    <div className="space-y-3 xl:grid xl:grid-cols-[minmax(0,1fr)_minmax(20rem,0.88fr)] xl:items-stretch xl:gap-4 xl:space-y-0">
      <div className="w-full min-w-0 xl:row-span-2">
        {children ?? (
          <TodoProgress totalCount={totalCount} completedCount={completedCount} />
        )}
      </div>

      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 sm:gap-3 lg:grid-cols-4 xl:grid-cols-2 xl:gap-3">
        {/* Total */}
        <Card className="flex flex-col justify-between p-3.5 transition hover:border-app-accent/40 sm:p-4">
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
        <Card className="flex flex-col justify-between p-3.5 transition hover:border-emerald-500/40 sm:p-4">
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
        <Card className="flex flex-col justify-between p-3.5 transition hover:border-sky-500/40 sm:p-4">
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
        <Card className="flex flex-col justify-between p-3.5 transition hover:border-amber-500/40 sm:p-4">
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
      </div>

      {onAddTodo && (
        <button
          type="button"
          onClick={onAddTodo}
          className="group hidden min-h-[4.5rem] w-full items-center justify-between gap-4 rounded-full border border-app-accent/25 bg-app-accent/10 px-4 py-2.5 text-app-accent transition-colors hover:bg-app-accent/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-accent/50 xl:flex xl:px-5"
          aria-label="Add a todo"
        >
          <span className="flex min-w-0 items-center gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-app-accent text-white shadow-sm">
              <Icon name="plus" className="size-5" />
            </span>
            <span className="min-w-0 text-left">
              <span className="block text-sm font-semibold">Add Todo</span>
              <span className="mt-0.5 block truncate text-xs text-app-muted">
                Organize your next priority
              </span>
            </span>
          </span>
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-app-surface/80 text-app-accent transition-transform group-hover:translate-x-0.5">
            <Icon name="chevron-right" className="size-4" />
          </span>
        </button>
      )}
    </div>
  );
}
