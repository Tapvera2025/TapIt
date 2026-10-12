import type { RecruitmentTab } from '../types/index.js';
import { Icon } from '../../../ui/Icon.js';

interface TabItem {
  readonly id: RecruitmentTab;
  readonly label: string;
  readonly path: string;
  readonly iconName: string;
}

const TABS: TabItem[] = [
  { id: 'overview', label: 'Overview', path: '/company/recruitment', iconName: 'chart' },
  { id: 'requisitions', label: 'Requisitions', path: '/company/recruitment/requisitions', iconName: 'briefcase' },
  { id: 'resumes', label: 'Resume Inbox', path: '/company/recruitment/resumes', iconName: 'notepad' },
  { id: 'candidates', label: 'Candidates', path: '/company/recruitment/candidates', iconName: 'users' },
  { id: 'interviews', label: 'Interviews', path: '/company/recruitment/interviews', iconName: 'history' },
  { id: 'offers', label: 'Offers', path: '/company/recruitment/offers', iconName: 'check' },
  { id: 'joining', label: 'Joining', path: '/company/recruitment/joining', iconName: 'building' },
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
    <div className="mb-4 w-full">
      <nav
        className="-mb-px flex flex-nowrap items-center gap-1 overflow-x-auto rounded-xl bg-app-surface/60 p-1.5 scrollbar-none [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
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
              className={`flex shrink-0 items-center gap-2 rounded-lg border border-transparent px-3.5 py-2 text-sm font-semibold transition whitespace-nowrap md:px-4 md:py-2.5 ${
                isActive
                  ? 'border-app-accent/20 bg-app-accent/10 text-app-accent'
                  : 'text-app-muted hover:border-app-border hover:bg-app-surface hover:text-app-foreground'
              }`}
            >
              <Icon name={tab.iconName} className="size-4 shrink-0" />
              <span>{tab.label}</span>
              {count !== undefined && count > 0 && (
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-bold ${
                    isActive
                      ? 'bg-app-accent text-app-on-accent'
                      : 'border border-app-border bg-app-surface-raised text-app-muted'
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
