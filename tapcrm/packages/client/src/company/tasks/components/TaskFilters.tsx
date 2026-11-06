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
  const [isMobileFiltersOpen, setIsMobileFiltersOpen] = useState(false);

  // Sync internal search input when query prop resets externally
  useEffect(() => {
    setSearchInput(query.search ?? '');
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
    <div className="flex flex-col gap-2 rounded-2xl border border-app-border/80 bg-app-surface/70 p-2.5 sm:px-3.5 sm:py-2.5 text-app-foreground">
      <style>{`
        .task-filter-scroller::-webkit-scrollbar {
          display: none !important;
          height: 0 !important;
          width: 0 !important;
        }
      `}</style>

      <button
        type="button"
        disabled={disabled}
        onClick={() => setIsMobileFiltersOpen((open) => !open)}
        className="inline-flex min-h-9 items-center justify-between rounded-xl border border-app-border bg-app-background/60 px-3 text-xs font-semibold text-app-foreground sm:hidden"
        aria-expanded={isMobileFiltersOpen}
        aria-controls="task-filters-panel"
      >
        <span className="inline-flex items-center gap-2">
          <Icon name="filter" className="size-4 text-app-accent" />
          Filters
        </span>
        <Icon name={isMobileFiltersOpen ? 'chevron-up' : 'chevron-down'} className="size-4 text-app-muted" />
      </button>

      <div id="task-filters-panel" className={`${isMobileFiltersOpen ? 'flex' : 'hidden'} flex-col gap-2 sm:flex`}>
        {/* Row 1: Scope, Filter status presets, and Due date */}
        <div className="flex flex-wrap items-center gap-2 sm:gap-2.5 min-w-0 w-full">
        {isSuperAdmin && (
          <div className="flex items-center gap-1.5 w-full sm:w-auto shrink-0">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-app-muted shrink-0">
              Scope:
            </span>
            <div className="grid grid-cols-2 sm:flex sm:items-center rounded-lg border border-app-border bg-app-background/60 p-0.5 w-full sm:w-auto">
              <button
                type="button"
                disabled={disabled}
                onClick={() => onViewScopeChange?.('my_tasks')}
                className={`rounded-md px-2.5 py-1 text-xs font-semibold text-center transition ${
                  viewScope === 'my_tasks'
                    ? 'bg-app-accent text-white shadow-xs'
                    : 'text-app-muted hover:text-app-foreground'
                }`}
                aria-pressed={viewScope === 'my_tasks'}
              >
                My Tasks
              </button>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onViewScopeChange?.('all_employee_tasks')}
                className={`rounded-md px-2.5 py-1 text-xs font-semibold text-center transition ${
                  viewScope === 'all_employee_tasks'
                    ? 'bg-app-accent text-white shadow-xs'
                    : 'text-app-muted hover:text-app-foreground'
                }`}
                aria-pressed={viewScope === 'all_employee_tasks'}
              >
                All Employee Tasks
              </button>
            </div>
            {viewScope === 'all_employee_tasks' && (
              <span className="hidden xl:inline-flex items-center rounded-md bg-app-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-app-accent">
                Org-wide
              </span>
            )}
          </div>
        )}

        {isSuperAdmin && (
          <span className="hidden h-5 w-px bg-app-border/70 sm:block" aria-hidden="true" />
        )}

        {/* Filter status presets - smooth swipeable on mobile, flex on desktop */}
        <div className="flex min-w-0 w-full sm:w-auto sm:max-w-full items-center gap-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-app-muted shrink-0">
            Filter
          </span>
          <div
            className="task-filter-scroller flex min-w-0 flex-1 items-center gap-1 overflow-x-auto pb-0.5 pe-4 sm:pe-0"
            style={{
              scrollbarWidth: 'none',
              msOverflowStyle: 'none',
              WebkitOverflowScrolling: 'touch',
            }}
          >
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
              return (
                <button
                  key={preset.id}
                  type="button"
                  disabled={disabled}
                  onClick={() => handleSelectGroup1(preset.id)}
                  className={`inline-flex shrink-0 items-center justify-center rounded-lg px-2.5 py-1 text-center text-xs font-semibold transition ${
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
        </div>

        <span className="hidden h-5 w-px bg-app-border/70 lg:block" aria-hidden="true" />

        {/* Due date filter */}
        <label className="flex items-center gap-1.5 shrink-0 text-xs">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-app-muted shrink-0">
            Due date
          </span>
          <select
            value={query.datePreset ?? 'all'}
            disabled={disabled}
            onChange={(e) => handleDatePresetChange(e.target.value)}
            className="h-8 rounded-lg border border-app-border bg-app-background/70 px-2.5 text-xs font-medium text-app-foreground outline-none focus:border-app-accent cursor-pointer"
            aria-label="Filter by date preset"
          >
            <option value="all">All Dates</option>
            <option value="today">Today</option>
            <option value="this_month">This Month</option>
            <option value="overdue">Overdue</option>
          </select>
        </label>
        </div>

        {/* Row 2: Sort on the left, Search Bar & Create Task aligned with Sort on the right */}
        <div className="flex flex-col gap-2 pt-2 border-t border-app-border/40 sm:flex-row sm:items-center sm:justify-between w-full">
        {/* Sort controls */}
        <div className="flex flex-wrap items-center gap-1.5 text-xs shrink-0">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-app-muted shrink-0">
            Sort
          </span>
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
            className="h-8 rounded-lg border border-app-border bg-app-background/70 px-2.5 text-xs text-app-foreground outline-none focus:border-app-accent cursor-pointer"
            aria-label="Sort by attribute"
          >
            <option value="createdAt">Created Date</option>
            <option value="dueDate">Due Date</option>
            <option value="title">Title</option>
            <option value="priority">Priority</option>
            <option value="status">Status</option>
          </select>
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
            className="h-8 rounded-lg border border-app-border bg-app-background/70 px-2.5 text-xs text-app-foreground outline-none focus:border-app-accent cursor-pointer"
            aria-label="Sort order"
          >
            <option value="desc">Descending (↓)</option>
            <option value="asc">Ascending (↑)</option>
          </select>
        </div>

        {/* Right cluster: Search Bar & Primary Action Button (aligned with sort on desktop/laptop) */}
        <div className="flex items-center gap-2 w-full sm:w-auto sm:ml-auto shrink-0 justify-between sm:justify-end">
          <div className="task-search-glass relative flex h-8 min-w-0 flex-1 sm:flex-initial sm:w-56 lg:w-64 items-center gap-1.5 rounded-lg border border-app-border/80 bg-app-surface/75 px-2.5 shadow-xs backdrop-blur-xl transition-[border-color,box-shadow,background-color] focus-within:border-app-accent/60 focus-within:ring-1 focus-within:ring-app-accent/30">
            <Icon name="search" className="size-3.5 shrink-0 text-app-muted" />
            <input
              type="search"
              disabled={disabled}
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search tasks..."
              className="min-w-0 flex-1 bg-transparent py-0 text-xs text-app-foreground outline-none placeholder:text-app-muted/80 disabled:opacity-50"
              aria-label="Search tasks"
            />
            {searchInput && (
              <button
                type="button"
                onClick={() => setSearchInput('')}
                className="grid size-5 shrink-0 place-items-center rounded-full text-app-muted transition-colors hover:bg-app-accent/10 hover:text-app-accent focus-visible:outline-none"
                aria-label="Clear search"
              >
                <Icon name="close" className="size-3" />
              </button>
            )}
          </div>
          {onCreateTask && (
            <Button
              type="button"
              kind="primary"
              disabled={disabled}
              onClick={onCreateTask}
              className="!h-8 !py-0 !px-3.5 !text-xs font-semibold shrink-0 whitespace-nowrap inline-flex items-center justify-center rounded-lg"
            >
              <span aria-hidden="true" className="mr-1 text-sm leading-none">+</span> Create Task
            </Button>
          )}
        </div>
        </div>
      </div>
    </div>
  );
}
