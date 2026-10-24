import { useEffect, useState } from 'react';
import { Icon } from '../../../ui/Icon.js';
import type { TodoFilterPriority, TodoSectionTab } from '../types/index.js';

export interface TodoFiltersProps {
  readonly search: string;
  readonly onSearchChange: (value: string) => void;
  readonly priority: TodoFilterPriority;
  readonly onPriorityChange: (value: TodoFilterPriority) => void;
  readonly activeTab?: TodoSectionTab;
  readonly onTabChange?: (tab: TodoSectionTab) => void;
  readonly tabCounts?: {
    readonly all: number;
    readonly today: number;
    readonly upcoming: number;
    readonly completed: number;
  };
  readonly disabled?: boolean;
}

export function TodoFilters({
  search,
  onSearchChange,
  priority,
  onPriorityChange,
  activeTab = 'all',
  onTabChange,
  tabCounts,
  disabled = false,
}: TodoFiltersProps): React.JSX.Element {
  const [isSearchOpen, setIsSearchOpen] = useState(Boolean(search));
  const tabs: { key: TodoSectionTab; label: string; count?: number | undefined }[] = [
    { key: 'all', label: 'All', count: tabCounts?.all },
    { key: 'today', label: 'Today', count: tabCounts?.today },
    { key: 'upcoming', label: 'Upcoming', count: tabCounts?.upcoming },
    { key: 'completed', label: 'Completed', count: tabCounts?.completed },
  ];
  const hasActiveFilters =
    Boolean(search.trim()) || priority !== 'all' || activeTab !== 'all';

  useEffect(() => {
    if (search.trim()) setIsSearchOpen(true);
  }, [search]);

  return (
    <div className="flex flex-col gap-3 sm:flex-row min-w-0 max-w-full rounded-2xl border border-app-border/80 bg-app-surface/70 p-3 sm:items-center sm:justify-between sm:p-3.5 lg:flex-row">
      <style>{`
        .todo-tab-scroller::-webkit-scrollbar {
          display: none !important;
          height: 0 !important;
          width: 0 !important;
        }
      `}</style>

      {/* Tab / Chip filters */}
      <div
        className="todo-tab-scroller flex min-w-0 max-w-full items-center gap-1.5 overflow-x-auto pb-0.5 lg:flex-1"
        style={{
          scrollbarWidth: 'none',
          msOverflowStyle: 'none',
          WebkitOverflowScrolling: 'touch',
        }}
      >
        {tabs.map((tab) => {
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              disabled={disabled}
              onClick={() => onTabChange?.(tab.key)}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                isActive
                  ? 'bg-app-accent text-white'
                  : 'border border-app-border bg-app-background/60 text-app-muted hover:border-app-accent/40 hover:text-app-foreground'
              } disabled:opacity-50`}
            >
              <span>{tab.label}</span>
              {typeof tab.count === 'number' && (
                <span
                  className={`rounded-full px-1.5 py-0.2 text-[10px] font-bold ${
                    isActive
                      ? 'bg-white/20 text-white'
                      : 'bg-app-border/70 text-app-muted'
                  }`}
                >
                  {tab.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Search & Priority Controls */}
      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center lg:w-auto lg:justify-end">
        <div
          className={`min-w-0 ${
            isSearchOpen
              ? 'w-full flex-1 sm:w-52 sm:flex-initial lg:w-60'
              : 'w-full shrink-0 sm:w-auto'
          }`}
        >
          {isSearchOpen ? (
            <div className="task-search-glass task-search-expanding relative flex min-w-0 w-full items-center gap-2 rounded-full border border-app-border/80 bg-app-surface/75 px-3.5 py-1 shadow-sm backdrop-blur-xl transition-[border-color,box-shadow,background-color] focus-within:border-app-accent/50 focus-within:shadow-[0_0_0_3px_color-mix(in_srgb,var(--app-accent)_12%,transparent)] sm:px-4">
              <Icon name="search" className="size-[18px] shrink-0 text-app-muted" />
              <input
                type="search"
                autoFocus
                value={search}
                onChange={(event) => onSearchChange(event.target.value)}
                placeholder="Search todos..."
                disabled={disabled}
                className="min-w-0 flex-1 bg-transparent py-2 text-xs text-app-foreground outline-none placeholder:text-app-muted/80 disabled:opacity-50 sm:text-sm"
                aria-label="Search todos"
              />
              <button
                type="button"
                onClick={() => {
                  onSearchChange('');
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
              className="task-search-trigger ml-auto inline-flex size-11 shrink-0 items-center justify-center rounded-full border border-app-border/80 bg-app-surface/75 text-app-muted shadow-sm backdrop-blur-xl transition-[color,border-color,background-color,box-shadow] hover:border-app-accent/50 hover:bg-app-accent/10 hover:text-app-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-accent/50 disabled:opacity-50 sm:ml-0"
              aria-label="Open todo search"
              title="Search todos"
            >
              <Icon name="search" className="size-[18px]" />
            </button>
          )}
        </div>

        <div className="w-full shrink-0 sm:w-36">
          <select
            value={priority}
            onChange={(e) => onPriorityChange(e.target.value as TodoFilterPriority)}
            disabled={disabled}
            className="h-9 w-full rounded-xl border border-app-border bg-app-background/60 px-2.5 text-xs text-app-foreground outline-none focus:border-app-accent disabled:opacity-50 sm:text-sm"
            aria-label="Filter by priority"
          >
            <option value="all">All priorities</option>
            <option value="high">High priority</option>
            <option value="medium">Medium priority</option>
            <option value="low">Low priority</option>
          </select>
        </div>
        {hasActiveFilters && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              onSearchChange('');
              onPriorityChange('all');
              onTabChange?.('all');
            }}
            className="h-9 shrink-0 rounded-xl px-2.5 text-xs font-semibold text-app-muted transition hover:bg-app-background hover:text-app-foreground disabled:opacity-50"
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
}
