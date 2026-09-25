import { useEffect, useState } from 'react';
import type { TaskFiltersProps, TaskListQuery } from '../types/index.js';

type PresetGroup1 = 'all' | 'pending' | 'in_progress' | 'high' | 'completed';

export function TaskFilters({
  query,
  onQueryChange,
  disabled = false,
  isSuperAdmin = false,
  viewScope = 'my_tasks',
  onViewScopeChange,
}: TaskFiltersProps): React.JSX.Element {
  const [searchInput, setSearchInput] = useState(query.search ?? '');

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
    <div className="space-y-4 rounded-xl border border-app-border bg-app-surface p-4 text-app-foreground shadow-sm">
      {/* Super Admin Task Scope Selector */}
      {isSuperAdmin && (
        <div className="flex flex-col gap-2 border-b border-app-border/60 pb-3 sm:flex-row sm:items-center sm:justify-between">
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
          </div>
          {viewScope === 'all_employee_tasks' && (
            <span className="inline-flex items-center rounded-md bg-app-accent/10 px-2 py-0.5 text-[11px] font-medium text-app-accent">
              Super Admin View • Organization-wide
            </span>
          )}
        </div>
      )}

      {/* Top row: Search and Sorting */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        {/* Search input with clear button */}
        <div className="relative w-full md:max-w-md">
          <input
            type="text"
            disabled={disabled}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search tasks by title or description..."
            className="w-full rounded-lg border border-app-border bg-app-background py-2 pl-3 pr-8 text-sm text-app-foreground outline-none transition focus:border-app-accent disabled:opacity-50"
            aria-label="Search tasks"
          />
          {searchInput && (
            <button
              type="button"
              onClick={() => setSearchInput('')}
              className="absolute right-2.5 top-2.5 text-xs text-app-muted hover:text-app-foreground"
              aria-label="Clear search"
            >
              ✕
            </button>
          )}
        </div>

        {/* Sorting controls: single row on mobile with 2 equal columns */}
        <div className="grid w-full grid-cols-2 gap-2 text-xs sm:flex sm:w-auto sm:items-center">
          <label className="flex w-full items-center gap-1.5 font-medium text-app-muted sm:w-auto">
            <span className="hidden shrink-0 sm:inline">Sort:</span>
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
              className="w-full rounded-lg border border-app-border bg-app-background px-2.5 py-2 text-xs text-app-foreground outline-none focus:border-app-accent sm:py-1.5"
              aria-label="Sort by attribute"
            >
              <option value="createdAt">Created Date</option>
              <option value="dueDate">Due Date</option>
              <option value="title">Title</option>
              <option value="priority">Priority</option>
              <option value="status">Status</option>
            </select>
          </label>

          <label className="flex w-full items-center font-medium text-app-muted sm:w-auto">
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
              className="w-full rounded-lg border border-app-border bg-app-background px-2.5 py-2 text-xs text-app-foreground outline-none focus:border-app-accent sm:py-1.5"
              aria-label="Sort order"
            >
              <option value="desc">Descending (↓)</option>
              <option value="asc">Ascending (↑)</option>
            </select>
          </label>
        </div>
      </div>

      {/* Filter Section: Proper row & column arrangement */}
      <div className="space-y-3 border-t border-app-border/60 pt-3">
        {/* Status & Priority Presets */}
        <div>
          <span className="mb-2 block text-xs font-semibold text-app-muted">
            Status & Priority:
          </span>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:flex md:flex-wrap md:gap-1.5">
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
                  className={`flex w-full items-center justify-center rounded-lg px-3 py-2 text-center text-xs font-semibold transition sm:w-auto sm:py-1.5 ${
                    isCompleted
                      ? 'col-span-2 sm:col-span-1 md:col-span-auto'
                      : ''
                  } ${
                    isActive
                      ? 'bg-app-accent text-white shadow-sm'
                      : 'border border-app-border bg-app-surface text-app-foreground hover:border-app-accent/60'
                  }`}
                  aria-pressed={isActive}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Date Filter Preset */}
        <div className="flex flex-col gap-1.5 pt-1 sm:flex-row sm:items-center sm:gap-3">
          <span className="shrink-0 text-xs font-semibold text-app-muted">
            Date Filter:
          </span>
          <select
            value={query.datePreset ?? 'all'}
            disabled={disabled}
            onChange={(e) => handleDatePresetChange(e.target.value)}
            className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2 text-xs font-medium text-app-foreground outline-none focus:border-app-accent sm:w-auto sm:py-1.5"
            aria-label="Filter by date preset"
          >
            <option value="all">All Dates</option>
            <option value="today">Today</option>
            <option value="this_month">This Month</option>
            <option value="overdue">Overdue</option>
          </select>
        </div>
      </div>
    </div>
  );
}
