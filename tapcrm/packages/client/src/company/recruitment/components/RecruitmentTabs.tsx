import type { RecruitmentTab } from '../types/index.js';

interface TabItem {
  readonly id: RecruitmentTab;
  readonly label: string;
  readonly path: string;
  readonly iconSymbol: string;
}

const TABS: TabItem[] = [
  { id: 'overview', label: 'Overview', path: '/company/recruitment', iconSymbol: '📊' },
  { id: 'requisitions', label: 'Requisitions', path: '/company/recruitment/requisitions', iconSymbol: '📋' },
  { id: 'resumes', label: 'Resume Inbox', path: '/company/recruitment/resumes', iconSymbol: '📥' },
  { id: 'candidates', label: 'Candidates', path: '/company/recruitment/candidates', iconSymbol: '👥' },
  { id: 'interviews', label: 'Interviews', path: '/company/recruitment/interviews', iconSymbol: '📅' },
  { id: 'offers', label: 'Offers', path: '/company/recruitment/offers', iconSymbol: '✉' },
  { id: 'joining', label: 'Joining', path: '/company/recruitment/joining', iconSymbol: '🤝' },
];

export function RecruitmentTabs({
  activeTab,
  onNavigate,
  counts,
}: {
  readonly activeTab: RecruitmentTab;
  readonly onNavigate: (path: string) => void;
  readonly counts?: Partial<Record<RecruitmentTab, number>> | undefined;
}): React.JSX.Element {
  return (
    <div className="mb-6 border-b border-app-border">
      <nav
        className="-mb-px flex flex-wrap gap-2 overflow-x-auto py-1"
        aria-label="Recruitment sections"
      >
        {TABS.map((tab) => {
          const isActive = activeTab === tab.id;
          const count = counts?.[tab.id];

          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => onNavigate(tab.path)}
              className={`flex items-center gap-2 rounded-t-xl border-b-2 px-4 py-3 text-sm font-semibold transition whitespace-nowrap ${
                isActive
                  ? 'border-app-accent bg-app-accent/10 text-app-accent'
                  : 'border-transparent text-app-muted hover:border-app-border hover:bg-app-surface hover:text-app-foreground'
              }`}
            >
              <span className="text-sm" aria-hidden="true">
                {tab.iconSymbol}
              </span>
              <span>{tab.label}</span>
              {count !== undefined && count > 0 && (
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-bold ${
                    isActive
                      ? 'bg-app-accent text-app-on-accent'
                      : 'bg-app-surface-raised border border-app-border text-app-muted'
                  }`}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
