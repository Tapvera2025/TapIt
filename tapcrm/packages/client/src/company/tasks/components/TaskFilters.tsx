import { useEffect, useRef, useState } from 'react';
import { Icon } from '../../../ui/index.js';
import type { TaskFiltersProps, TaskListQuery } from '../types/index.js';

function toDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseDateKey(value: string): Date | null {
  if (!value) return null;
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

export function TaskFilters({
  query,
  onQueryChange,
  disabled = false,
  isSuperAdmin = false,
  viewScope = 'my_tasks',
  onViewScopeChange,
  viewMode = 'list',
  onViewModeChange,
}: TaskFiltersProps): React.JSX.Element {
  const [searchInput, setSearchInput] = useState(query.search ?? '');
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const [dateSubmenuOpen, setDateSubmenuOpen] = useState(false);
  const [rangePickerOpen, setRangePickerOpen] = useState(false);
  const [draftStartDate, setDraftStartDate] = useState('');
  const [draftEndDate, setDraftEndDate] = useState('');
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const existingStart = query.datePreset === 'custom' && query.startDate
      ? parseDateKey(query.startDate.slice(0, 10))
      : null;
    const initialDate = existingStart ?? new Date();
    return new Date(initialDate.getFullYear(), initialDate.getMonth(), 1);
  });
  const sortMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!sortMenuOpen && !rangePickerOpen) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!sortMenuRef.current?.contains(event.target as Node)) {
        setSortMenuOpen(false);
        setDateSubmenuOpen(false);
        setRangePickerOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSortMenuOpen(false);
        setDateSubmenuOpen(false);
        setRangePickerOpen(false);
      }
    };
    document.addEventListener('pointerdown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [sortMenuOpen, rangePickerOpen]);

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

  function setDatePreset(preset: 'all' | 'today' | 'this_month') {
    onQueryChange({
      ...query,
      sortBy: 'dueDate',
      datePreset: preset,
      startDate: undefined,
      endDate: undefined,
      page: 1,
    });
    setSortMenuOpen(false);
    setDateSubmenuOpen(false);
  }

  function setSortBy(sortBy: NonNullable<TaskListQuery['sortBy']>) {
    onQueryChange({ ...query, sortBy, page: 1 });
    setSortMenuOpen(false);
    setDateSubmenuOpen(false);
  }

  function openCustomRange() {
    const start = query.datePreset === 'custom' ? query.startDate?.slice(0, 10) ?? '' : '';
    const end = query.datePreset === 'custom' ? query.endDate?.slice(0, 10) ?? '' : '';
    setDraftStartDate(start);
    setDraftEndDate(end);
    const initialDate = parseDateKey(start) ?? new Date();
    setCalendarMonth(new Date(initialDate.getFullYear(), initialDate.getMonth(), 1));
    setSortMenuOpen(false);
    setDateSubmenuOpen(false);
    setRangePickerOpen(true);
  }

  function selectCalendarDate(date: Date) {
    const selectedDate = toDateKey(date);
    if (!draftStartDate || draftEndDate) {
      setDraftStartDate(selectedDate);
      setDraftEndDate('');
    } else if (selectedDate < draftStartDate) {
      setDraftStartDate(selectedDate);
      setDraftEndDate('');
    } else {
      setDraftEndDate(selectedDate);
    }
  }

  function selectQuickRange(range: 'today' | 'week' | 'month') {
    const today = new Date();
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const end = new Date(start);
    if (range === 'week') {
      const daysSinceMonday = (start.getDay() + 6) % 7;
      start.setDate(start.getDate() - daysSinceMonday);
      end.setTime(start.getTime());
      end.setDate(end.getDate() + 6);
    } else if (range === 'month') {
      start.setDate(1);
      end.setMonth(end.getMonth() + 1, 0);
    }
    setDraftStartDate(toDateKey(start));
    setDraftEndDate(toDateKey(end));
    setCalendarMonth(new Date(start.getFullYear(), start.getMonth(), 1));
  }

  function applyCustomRange() {
    if (!draftStartDate || !draftEndDate) return;
    onQueryChange({
      ...query,
      datePreset: 'custom',
      startDate: draftStartDate,
      endDate: draftEndDate,
      page: 1,
    });
    setRangePickerOpen(false);
  }

  const sortLabel = query.sortBy === 'priority'
      ? 'Priority'
      : query.sortBy === 'status'
        ? 'Status'
        : query.sortBy === 'dueDate'
          ? 'Due Date'
          : 'Created Date';

  function formatDateRangeLabel(value: string | undefined): string {
    const date = value ? parseDateKey(value.slice(0, 10)) : null;
    return date
      ? date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
      : '';
  }

  function clearCustomRange() {
    onQueryChange({
      ...query,
      datePreset: 'all',
      startDate: undefined,
      endDate: undefined,
      page: 1,
    });
  }

  const calendarFirstDay = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 1).getDay();
  const calendarDaysInMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 0).getDate();
  const calendarCells: (Date | null)[] = [
    ...Array.from({ length: calendarFirstDay }, () => null),
    ...Array.from(
      { length: calendarDaysInMonth },
      (_, index) => new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), index + 1),
    ),
  ];

  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-app-border/80 bg-app-surface/70 p-2.5 sm:px-3.5 sm:py-2.5 text-app-foreground">
      <div id="task-filters-panel" className="flex flex-wrap items-center gap-2 sm:gap-2.5">
        <div className="contents">
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
          </div>
        )}

        {isSuperAdmin && (
          <span className="hidden h-5 w-px bg-app-border/70 sm:block" aria-hidden="true" />
        )}

        </div>

        <div className="contents">
        {/* Sort controls */}
        <div className="flex flex-wrap items-center gap-1.5 text-xs shrink-0">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-app-muted shrink-0">
            Sort
          </span>
          <div ref={sortMenuRef} className="relative flex items-center gap-1.5">
            <button
              type="button"
              disabled={disabled}
              onClick={() => {
                setSortMenuOpen((open) => !open);
                setDateSubmenuOpen(false);
              }}
              className="inline-flex h-8 min-w-32 items-center justify-between gap-3 rounded-lg border border-app-border bg-app-background/70 px-2.5 text-xs font-medium text-app-foreground outline-none transition-colors hover:border-app-accent/50 focus:border-app-accent disabled:opacity-50"
              aria-label="Sort tasks"
              aria-haspopup="menu"
              aria-expanded={sortMenuOpen}
            >
              <span className="truncate">{sortLabel}</span>
              <Icon name="chevron-down" className={`size-3.5 shrink-0 text-app-muted transition-transform ${sortMenuOpen ? 'rotate-180' : ''}`} />
            </button>

            {query.datePreset === 'custom' && (
              <div className="inline-flex h-8 shrink-0 items-center rounded-lg border border-app-accent/30 bg-app-accent/5 text-[10px] text-app-foreground sm:text-xs">
                <button
                  type="button"
                  onClick={openCustomRange}
                  className="inline-flex h-full items-center gap-1.5 px-2"
                  aria-label="Edit custom due date range"
                >
                  <Icon name="calendar" className="size-3.5 text-app-accent" />
                  <span>{formatDateRangeLabel(query.startDate) || 'Start'} – {formatDateRangeLabel(query.endDate) || 'End'}</span>
                </button>
                <button
                  type="button"
                  onClick={clearCustomRange}
                  className="grid h-full w-7 place-items-center rounded-r-lg text-app-muted hover:bg-app-accent/10 hover:text-app-accent"
                  aria-label="Clear custom date range"
                >
                  ×
                </button>
              </div>
            )}

            {sortMenuOpen && (
              <div
                role="menu"
                aria-label="Sort and date options"
                className="absolute left-0 top-full z-50 mt-1 w-48 rounded-xl border border-app-border bg-app-surface p-1.5 shadow-xl"
              >
                {([
                  ['priority', 'Priority'],
                  ['status', 'Status'],
                ] as const).map(([sortBy, label]) => (
                  <button
                    key={sortBy}
                    type="button"
                    role="menuitem"
                    onClick={() => setSortBy(sortBy)}
                    className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-xs text-app-foreground transition-colors hover:bg-app-surface-raised"
                  >
                    {label}
                    {query.sortBy === sortBy && <span className="text-app-accent">✓</span>}
                  </button>
                ))}

                <div
                  className="relative"
                  onMouseEnter={() => setDateSubmenuOpen(true)}
                  onMouseLeave={() => setDateSubmenuOpen(false)}
                >
                  <button
                    type="button"
                    role="menuitem"
                    onFocus={() => setDateSubmenuOpen(true)}
                    onClick={() => setDateSubmenuOpen(true)}
                    className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-xs text-app-foreground transition-colors hover:bg-app-surface-raised"
                    aria-haspopup="menu"
                    aria-expanded={dateSubmenuOpen}
                  >
                    Due Date
                    <Icon name="chevron-right" className="size-3.5 text-app-muted" />
                  </button>
                  {dateSubmenuOpen && (
                    <div
                      role="menu"
                      aria-label="Due date range"
                      className="absolute left-0 top-full z-50 mt-1 w-40 rounded-xl border border-app-border bg-app-surface p-1.5 shadow-xl sm:left-full sm:top-0 sm:mt-0"
                    >
                      {([
                        ['all', 'All Dates'],
                        ['today', 'Today'],
                        ['this_month', 'This Month'],
                      ] as const).map(([preset, label]) => (
                        <button
                          key={preset}
                          type="button"
                          role="menuitem"
                          onClick={() => setDatePreset(preset)}
                          className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-xs text-app-foreground transition-colors hover:bg-app-surface-raised"
                        >
                          {label}
                          {query.sortBy === 'dueDate' && query.datePreset === preset && (
                            <span className="text-app-accent">✓</span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <button
                  type="button"
                  role="menuitem"
                  onClick={() => setSortBy('createdAt')}
                  className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-xs text-app-foreground transition-colors hover:bg-app-surface-raised"
                >
                  Created Date
                  {query.sortBy === 'createdAt' && <span className="text-app-accent">✓</span>}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={openCustomRange}
                  className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-xs text-app-accent transition-colors hover:bg-app-accent/10"
                >
                  Custom Range
                  <Icon name="calendar" className="size-3.5" />
                </button>
              </div>
            )}

            {rangePickerOpen && (
              <section
                role="dialog"
                aria-label="Select due date range"
                className="fixed left-3 right-3 top-1/2 z-[60] mx-auto max-h-[calc(100dvh-1.5rem)] w-auto max-w-[21rem] -translate-y-1/2 overflow-y-auto overscroll-contain rounded-2xl border border-app-border bg-app-surface p-4 shadow-2xl sm:absolute sm:left-0 sm:right-auto sm:top-full sm:mt-2 sm:mx-0 sm:max-h-[calc(100dvh-2rem)] sm:w-[min(21rem,calc(100vw-2rem))] sm:translate-y-0"
              >
                <header className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold text-app-foreground">Select date range</h3>
                  <button
                    type="button"
                    onClick={() => {
                      setDraftStartDate('');
                      setDraftEndDate('');
                    }}
                    className="text-xs font-medium text-app-accent hover:underline"
                  >
                    Clear
                  </button>
                </header>

                <div className="mt-3 flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => setCalendarMonth((month) => new Date(month.getFullYear(), month.getMonth() - 1, 1))}
                    className="grid size-8 place-items-center rounded-lg text-app-muted hover:bg-app-surface-raised hover:text-app-foreground"
                    aria-label="Previous month"
                  >
                    <Icon name="chevron-left" className="size-4" />
                  </button>
                  <p className="text-sm font-semibold text-app-foreground">
                    {calendarMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
                  </p>
                  <button
                    type="button"
                    onClick={() => setCalendarMonth((month) => new Date(month.getFullYear(), month.getMonth() + 1, 1))}
                    className="grid size-8 place-items-center rounded-lg text-app-muted hover:bg-app-surface-raised hover:text-app-foreground"
                    aria-label="Next month"
                  >
                    <Icon name="chevron-right" className="size-4" />
                  </button>
                </div>

                <div className="mt-2 grid grid-cols-7 text-center text-[10px] font-semibold uppercase text-app-muted">
                  {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((day) => (
                    <span key={day} className="py-1">{day}</span>
                  ))}
                </div>
                <div className="grid grid-cols-7 gap-y-1 text-center">
                  {calendarCells.map((date, index) => {
                    if (!date) return <span key={`blank-${index}`} />;
                    const dateKey = toDateKey(date);
                    const isStart = dateKey === draftStartDate;
                    const isEnd = dateKey === draftEndDate;
                    const isInRange = Boolean(draftStartDate && draftEndDate && dateKey > draftStartDate && dateKey < draftEndDate);
                    return (
                      <button
                        key={dateKey}
                        type="button"
                        onClick={() => selectCalendarDate(date)}
                        aria-label={date.toLocaleDateString()}
                        aria-pressed={isStart || isEnd}
                        className={`mx-auto grid size-7 place-items-center rounded-full text-xs transition-colors sm:size-8 ${
                          isStart || isEnd
                            ? 'bg-app-accent text-white'
                            : isInRange
                              ? 'rounded-lg bg-app-accent/10 text-app-accent'
                              : 'text-app-foreground hover:bg-app-surface-raised'
                        }`}
                      >
                        {date.getDate()}
                      </button>
                    );
                  })}
                </div>

                <div className="mt-3 grid grid-cols-3 gap-1.5 border-t border-app-border/70 pt-3">
                  {([
                    ['today', 'Today'],
                    ['week', 'This Week'],
                    ['month', 'This Month'],
                  ] as const).map(([range, label]) => (
                    <button
                      key={range}
                      type="button"
                      onClick={() => selectQuickRange(range)}
                      className="min-h-8 rounded-lg bg-app-surface-raised px-1.5 text-[10px] font-medium text-app-muted transition-colors hover:bg-app-accent/10 hover:text-app-accent sm:text-xs"
                    >
                      {label}
                    </button>
                  ))}
                </div>

                <footer className="mt-3 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setRangePickerOpen(false)}
                    className="rounded-lg px-3 py-1.5 text-xs font-medium text-app-muted hover:bg-app-surface-raised hover:text-app-foreground"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={!draftStartDate || !draftEndDate}
                    onClick={applyCustomRange}
                    className="rounded-lg bg-app-accent px-3 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Apply
                  </button>
                </footer>
              </section>
            )}
          </div>
        </div>

        {/* Search and view switch stay together on the right side of the toolbar. */}
        <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
          <div className="task-search-glass relative flex h-8 min-w-0 flex-1 sm:flex-initial sm:w-52 lg:w-64 items-center gap-1.5 rounded-lg border border-app-border/80 bg-app-surface/75 px-2.5 shadow-xs backdrop-blur-xl transition-[border-color,box-shadow,background-color] focus-within:border-app-accent/60 focus-within:ring-1 focus-within:ring-app-accent/30">
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
          {onViewModeChange && (
            <div
              role="group"
              aria-label="Task layout view"
              className="inline-flex h-8 items-center rounded-lg border border-app-border bg-app-background/60 p-0.5 shrink-0"
            >
              <button
                type="button"
                disabled={disabled}
                onClick={() => onViewModeChange('list')}
                aria-label="List view"
                title="List view"
                className={`inline-flex h-full items-center gap-1.5 rounded-md px-2.5 text-xs font-semibold transition ${
                  viewMode === 'list'
                    ? 'bg-app-accent text-white shadow-xs'
                    : 'text-app-muted hover:text-app-foreground'
                }`}
                aria-pressed={viewMode === 'list'}
              >
                <Icon name="list" className="size-3.5" />
                <span className="hidden md:inline">List</span>
              </button>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onViewModeChange('kanban')}
                aria-label="Kanban board view"
                title="Kanban board view"
                className={`inline-flex h-full items-center gap-1.5 rounded-md px-2.5 text-xs font-semibold transition ${
                  viewMode === 'kanban'
                    ? 'bg-app-accent text-white shadow-xs'
                    : 'text-app-muted hover:text-app-foreground'
                }`}
                aria-pressed={viewMode === 'kanban'}
              >
                <Icon name="kanban" className="size-3.5" />
                <span className="hidden md:inline">Board</span>
              </button>
            </div>
          )}
        </div>
        </div>

      </div>
    </div>
  );
}
