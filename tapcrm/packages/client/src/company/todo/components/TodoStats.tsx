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
    <div className="flex flex-col gap-2.5 lg:grid lg:grid-cols-12 lg:items-stretch lg:gap-3">
      {/* Left: Progress card container */}
      <div className="w-full min-w-0 lg:col-span-5 flex">
        {children ?? (
          <TodoProgress totalCount={totalCount} completedCount={completedCount} />
        )}
      </div>

      {/* Right: 4 Stat Cards + Add Todo action */}
      <div className="flex flex-1 flex-col justify-between gap-2 lg:col-span-7">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-2.5 flex-1">
          {/* Total */}
          <Card className="flex flex-col justify-between p-2.5 sm:p-3 transition hover:border-app-accent/40 shadow-2xs">
            <div className="flex items-center justify-between gap-1">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-app-muted truncate">
                Total Todos
              </p>
              <span className="grid size-6 shrink-0 place-items-center rounded-lg bg-app-accent/10 text-app-accent">
                <Icon name="todo" className="size-3.5" />
              </span>
            </div>
            <p className="mt-1 text-xl font-bold tracking-tight tabular-nums text-app-foreground sm:text-2xl">
              {totalCount}
            </p>
          </Card>

          {/* Completed */}
          <Card className="flex flex-col justify-between p-2.5 sm:p-3 transition hover:border-emerald-500/40 shadow-2xs">
            <div className="flex items-center justify-between gap-1">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-app-muted truncate">
                Completed
              </p>
              <span className="grid size-6 shrink-0 place-items-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                <Icon name="check" className="size-3.5" />
              </span>
            </div>
            <p className="mt-1 text-xl font-bold tracking-tight tabular-nums text-app-foreground sm:text-2xl">
              {completedCount}
            </p>
          </Card>

          {/* Today */}
          <Card className="flex flex-col justify-between p-2.5 sm:p-3 transition hover:border-amber-500/40 shadow-2xs">
            <div className="flex items-center justify-between gap-1">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-app-muted truncate">
                Today
              </p>
              <span className="grid size-6 shrink-0 place-items-center rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400">
                <Icon name="history" className="size-3.5" />
              </span>
            </div>
            <p className="mt-1 text-xl font-bold tracking-tight tabular-nums text-app-foreground sm:text-2xl">
              {todayCount}
            </p>
          </Card>

          {/* Upcoming */}
          <Card className="flex flex-col justify-between p-2.5 sm:p-3 transition hover:border-sky-500/40 shadow-2xs">
            <div className="flex items-center justify-between gap-1">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-app-muted truncate">
                Upcoming
              </p>
              <span className="grid size-6 shrink-0 place-items-center rounded-lg bg-sky-500/10 text-sky-600 dark:text-sky-400">
                <Icon name="calendar" className="size-3.5" />
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
            className="group flex h-10 sm:h-11 w-full items-center justify-between gap-3 rounded-xl border border-app-accent/25 bg-app-accent/10 px-3.5 text-app-accent transition-all hover:bg-app-accent/15 hover:border-app-accent/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-accent/50 cursor-pointer"
            aria-label="Add a todo"
          >
            <span className="flex min-w-0 items-center gap-2.5">
              <span className="grid size-6 shrink-0 place-items-center rounded-lg bg-app-accent text-white shadow-xs">
                <Icon name="plus" className="size-3.5" />
              </span>
              <span className="text-xs sm:text-sm font-semibold text-app-foreground group-hover:text-app-accent transition-colors">
                Add Todo
              </span>
              <span className="hidden sm:inline text-xs text-app-muted truncate">
                — Organize your next priority
              </span>
            </span>
            <span className="grid size-6 shrink-0 place-items-center rounded-lg bg-app-surface/80 text-app-accent transition-transform group-hover:translate-x-0.5">
              <Icon name="chevron-right" className="size-3.5" />
            </span>
          </button>
        )}
      </div>
    </div>
  );
}
