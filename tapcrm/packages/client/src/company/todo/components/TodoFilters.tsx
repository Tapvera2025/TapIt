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

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between min-w-0 max-w-full">
      <style>{`
        .todo-tab-scroller::-webkit-scrollbar {
          display: none !important;
          height: 0 !important;
          width: 0 !important;
        }
      `}</style>

      {/* Tab / Chip filters */}
      <div
        className="todo-tab-scroller flex min-w-0 max-w-full items-center gap-1.5 overflow-x-auto pb-0.5"
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
                  ? 'bg-app-accent text-white shadow-xs'
                  : 'border border-app-border bg-app-surface text-app-muted hover:border-app-accent/40 hover:text-app-foreground'
              } disabled:opacity-50`}
            >
              <span>{tab.label}</span>
              {typeof tab.count === 'number' && (
                <span
                  className={`rounded-full px-1.5 py-0.2 text-[10px] font-bold ${
                    isActive
                      ? 'bg-white/20 text-white'
                      : 'bg-app-border text-app-muted'
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
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1 sm:w-52 sm:flex-initial">
          <input
            type="text"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search todos..."
            disabled={disabled}
            className="h-8 w-full rounded-lg border border-app-border bg-app-surface px-2.5 text-xs sm:text-sm text-app-foreground placeholder:text-app-muted outline-none focus:border-app-accent disabled:opacity-50"
            aria-label="Search todos"
          />
        </div>

        <div className="w-32 shrink-0 sm:w-36">
          <select
            value={priority}
            onChange={(e) => onPriorityChange(e.target.value as TodoFilterPriority)}
            disabled={disabled}
            className="h-8 w-full rounded-lg border border-app-border bg-app-surface px-2 text-xs sm:text-sm text-app-foreground outline-none focus:border-app-accent disabled:opacity-50"
            aria-label="Filter by priority"
          >
            <option value="all">All priorities</option>
            <option value="high">High priority</option>
            <option value="medium">Medium priority</option>
            <option value="low">Low priority</option>
          </select>
        </div>
      </div>
    </div>
  );
}
