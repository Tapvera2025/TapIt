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
  const tabs: { key: TodoSectionTab; label: string; count?: number | undefined }[] = [
    { key: 'all', label: 'All', count: tabCounts?.all },
    { key: 'today', label: 'Today', count: tabCounts?.today },
    { key: 'upcoming', label: 'Upcoming', count: tabCounts?.upcoming },
    { key: 'completed', label: 'Completed', count: tabCounts?.completed },
  ];
  const hasActiveFilters =
    Boolean(search.trim()) || priority !== 'all' || activeTab !== 'all';

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
        <div className="min-w-0 flex-1 sm:w-52 sm:flex-initial lg:w-60">
          <input
            type="text"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search todos..."
            disabled={disabled}
            className="h-9 w-full rounded-xl border border-app-border bg-app-background/60 px-3 text-xs text-app-foreground placeholder:text-app-muted outline-none focus:border-app-accent disabled:opacity-50 sm:text-sm"
            aria-label="Search todos"
          />
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
