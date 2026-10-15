import { useEffect, useState } from 'react';
import { Icon } from '../../../ui/Icon.js';
import { Button } from '../../../ui/components.js';
import type { TaskFiltersProps, TaskListQuery } from '../types/index.js';

type PresetGroup1 = 'all' | 'pending' | 'in_progress' | 'high' | 'completed';

export function TaskFilters({
  query,
  onQueryChange,
  onCreateTask,
  disabled = false,
  isSuperAdmin = false,
  viewScope = 'my_tasks',
  onViewScopeChange,
}: TaskFiltersProps): React.JSX.Element {
  const [searchInput, setSearchInput] = useState(query.search ?? '');
  const [isSearchOpen, setIsSearchOpen] = useState(Boolean(query.search));

  // Sync internal search input when query prop resets externally
  useEffect(() => {
    setSearchInput(query.search ?? '');
    if (query.search) setIsSearchOpen(true);
  }, [query.search]);

  // Debounce search input changes by 300ms
  useEffect(() => {
    const handler = setTimeout(() => {
      const trimmed = searchInput.trim();
      if ((query.search ?? '') !== trimmed) {
        onQueryChange({
          ...query,
          search: trimmed || undefined,
          page: 1, // Always reset to page 1 on filter/search change
        });
      }
    }, 300);

    return () => {
      clearTimeout(handler);
    };
  }, [searchInput]);

  // Determine active Group 1 preset
  const activePreset1: PresetGroup1 =
    query.priority === 'high' && (!query.status || query.status === 'all')
      ? 'high'
      : query.status === 'pending'
        ? 'pending'
        : query.status === 'in_progress'
          ? 'in_progress'
          : query.status === 'completed'
            ? 'completed'
            : 'all';

  function handleSelectGroup1(preset: PresetGroup1) {
    if (preset === 'high') {
      // High is strictly a priority filter, not a status filter
      onQueryChange({
        ...query,
        priority: 'high',
        status: 'all',
        page: 1,
      });
    } else if (preset === 'all') {
      onQueryChange({
        ...query,
        status: 'all',
        priority: 'all',
        page: 1,
      });
    } else {
      onQueryChange({
        ...query,
        status: preset,
        priority: 'all',
        page: 1,
      });
    }
  }

  function handleDatePresetChange(preset: string) {
    onQueryChange({
      ...query,
      datePreset: preset as TaskListQuery['datePreset'],
      startDate: undefined,
      endDate: undefined,
      page: 1,
    });
  }

  return (
    <div className="space-y-3 rounded-2xl border border-app-border/80 bg-app-surface/70 p-3 text-app-foreground sm:p-4">
      {/* Scope, on-demand search, and the primary action share one compact control row. */}
      <div className="flex flex-col gap-3 border-b border-app-border/60 pb-3 sm:flex-row sm:items-center sm:justify-between">
        {isSuperAdmin ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-app-muted">Scope:</span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={disabled}
                onClick={() => onViewScopeChange?.('my_tasks')}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                  viewScope === 'my_tasks'
                    ? 'bg-app-accent text-white shadow-sm'
                    : 'border border-app-border bg-app-surface text-app-foreground hover:border-app-accent/60'
                }`}
                aria-pressed={viewScope === 'my_tasks'}
              >
                My Tasks
              </button>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onViewScopeChange?.('all_employee_tasks')}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                  viewScope === 'all_employee_tasks'
                    ? 'bg-app-accent text-white shadow-sm'
                    : 'border border-app-border bg-app-surface text-app-foreground hover:border-app-accent/60'
                }`}
                aria-pressed={viewScope === 'all_employee_tasks'}
              >
                All Employee Tasks
              </button>
            </div>
            {viewScope === 'all_employee_tasks' && (
              <span className="inline-flex items-center rounded-md bg-app-accent/10 px-2 py-0.5 text-[11px] font-medium text-app-accent">
                Super Admin View · Organization-wide
              </span>
            )}
          </div>
        ) : (
          <span className="hidden sm:block" aria-hidden="true" />
        )}
        <div className="flex w-full items-center justify-end gap-2 sm:w-auto">
          {isSearchOpen ? (
            <div className="task-search-glass relative flex min-w-0 flex-1 items-center gap-2 rounded-full border border-app-border/80 bg-app-surface/75 px-4 py-1.5 shadow-sm backdrop-blur-xl transition-[border-color,box-shadow,background-color] focus-within:border-app-accent/50 focus-within:shadow-[0_0_0_3px_color-mix(in_srgb,var(--app-accent)_12%,transparent)] sm:w-72 sm:flex-none lg:w-80">
              <Icon name="search" className="size-[18px] shrink-0 text-app-muted" />
              <input
                type="search"
                autoFocus
                disabled={disabled}
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Search tasks..."
                className="min-w-0 flex-1 bg-transparent py-2 text-sm text-app-foreground outline-none placeholder:text-app-muted/80 disabled:opacity-50"
                aria-label="Search tasks"
              />
              <button
                type="button"
                onClick={() => {
                  setSearchInput('');
                  setIsSearchOpen(false);
                }}
                className="grid size-8 shrink-0 place-items-center rounded-full text-app-muted transition-colors hover:bg-app-accent/10 hover:text-app-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-accent/50"
                aria-label="Close search"
              >
                <Icon name="close" className="size-4" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              disabled={disabled}
              onClick={() => setIsSearchOpen(true)}
              className="task-search-trigger inline-flex size-11 shrink-0 items-center justify-center rounded-full border border-app-border/80 bg-app-surface/75 text-app-muted shadow-sm backdrop-blur-xl transition-[color,border-color,background-color,box-shadow] hover:border-app-accent/50 hover:bg-app-accent/10 hover:text-app-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-accent/50 disabled:opacity-50"
              aria-label="Open task search"
              title="Search tasks"
            >
              <Icon name="search" className="size-[18px]" />
            </button>
          )}
          {onCreateTask && (
            <Button
              type="button"
              kind="primary"
              disabled={disabled}
              onClick={onCreateTask}
              className="flex-1 whitespace-nowrap sm:flex-none"
            >
              <span aria-hidden="true">+</span> Create Task
            </Button>
          )}
        </div>
      </div>

      {/* A single compact toolbar keeps filtering and sorting visually related. */}
      <div className="flex flex-col gap-3 pt-1 xl:flex-row xl:items-center xl:justify-between">
        <div className="order-2 min-w-0 xl:order-1">
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-app-muted sm:mr-1">
              Filter
            </span>
            <div className="grid w-full grid-cols-2 gap-2 sm:w-auto sm:flex sm:flex-wrap sm:gap-1.5">
              {(
                [
                  { id: 'all', label: 'All' },
                  { id: 'pending', label: 'Pending' },
                  { id: 'in_progress', label: 'In Progress' },
                  { id: 'high', label: 'High Priority' },
                  { id: 'completed', label: 'Completed' },
                ] as const
              ).map((preset) => {
                const isActive = activePreset1 === preset.id;
                const isCompleted = preset.id === 'completed';
                return (
                  <button
                    key={preset.id}
                    type="button"
                    disabled={disabled}
                    onClick={() => handleSelectGroup1(preset.id)}
                    className={`flex w-full items-center justify-center rounded-xl px-3 py-2 text-center text-xs font-semibold transition sm:w-auto sm:py-1.5 ${
                      isCompleted ? 'col-span-2 sm:col-span-1' : ''
                    } ${
                      isActive
                        ? preset.id === 'pending'
                          ? 'border border-amber-500/30 bg-amber-500/15 text-amber-700 dark:text-amber-200'
                          : preset.id === 'in_progress'
                            ? 'border border-sky-500/30 bg-sky-500/15 text-sky-700 dark:text-sky-200'
                            : preset.id === 'completed'
                              ? 'border border-emerald-500/30 bg-emerald-500/15 text-emerald-700 dark:text-emerald-200'
                              : 'border border-app-accent/40 bg-app-accent/10 text-app-accent'
                        : 'border border-app-border bg-app-background/60 text-app-foreground hover:border-app-accent/60'
                    }`}
                    aria-pressed={isActive}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>
            <span
              className="hidden h-6 w-px bg-app-border/70 sm:block"
              aria-hidden="true"
            />
            <label className="flex w-full items-center justify-between gap-2 sm:w-auto sm:justify-start">
              <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-app-muted">
                Due date
              </span>
              <select
                value={query.datePreset ?? 'all'}
                disabled={disabled}
                onChange={(e) => handleDatePresetChange(e.target.value)}
                className="rounded-xl border border-app-border bg-app-background/70 px-3 py-2 text-xs font-medium text-app-foreground outline-none focus:border-app-accent"
                aria-label="Filter by date preset"
              >
                <option value="all">All Dates</option>
                <option value="today">Today</option>
                <option value="this_month">This Month</option>
                <option value="overdue">Overdue</option>
              </select>
            </label>
          </div>
        </div>

        <div className="order-1 grid w-full grid-cols-2 gap-2 text-xs sm:w-auto sm:flex sm:items-center xl:order-2 xl:shrink-0">
          <span className="col-span-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-app-muted sm:col-auto">
            Sort
          </span>
          <label className="flex min-w-0 items-center gap-1.5 font-medium text-app-muted">
            <select
              value={query.sortBy ?? 'createdAt'}
              disabled={disabled}
              onChange={(e) =>
                onQueryChange({
                  ...query,
                  sortBy: e.target.value as TaskListQuery['sortBy'],
                  page: 1,
                })
              }
              className="min-w-0 w-full rounded-xl border border-app-border bg-app-background/70 px-2.5 py-2 text-xs text-app-foreground outline-none focus:border-app-accent sm:w-auto"
              aria-label="Sort by attribute"
            >
              <option value="createdAt">Created Date</option>
              <option value="dueDate">Due Date</option>
              <option value="title">Title</option>
              <option value="priority">Priority</option>
              <option value="status">Status</option>
            </select>
          </label>
          <label className="flex min-w-0 items-center font-medium text-app-muted">
            <select
              value={query.sortOrder ?? 'desc'}
              disabled={disabled}
              onChange={(e) =>
                onQueryChange({
                  ...query,
                  sortOrder: e.target.value as 'asc' | 'desc',
                  page: 1,
                })
              }
              className="min-w-0 w-full rounded-xl border border-app-border bg-app-background/70 px-2.5 py-2 text-xs text-app-foreground outline-none focus:border-app-accent sm:w-auto"
              aria-label="Sort order"
            >
              <option value="desc">Descending (↓)</option>
              <option value="asc">Ascending (↑)</option>
            </select>
          </label>
        </div>
      </div>
    </div>
  );
}
