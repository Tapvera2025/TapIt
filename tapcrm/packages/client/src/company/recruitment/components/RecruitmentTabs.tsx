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
    <div className="mb-6 w-full border-b border-app-border">
      <nav
        className="-mb-px flex flex-nowrap items-center gap-1.5 overflow-x-auto pb-px pt-1 scrollbar-none [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
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
              className={`flex shrink-0 items-center gap-2 rounded-t-xl border-b-2 px-3.5 py-2.5 text-sm font-semibold transition whitespace-nowrap md:px-4 md:py-3 ${
                isActive
                  ? 'border-app-accent bg-app-accent/10 text-app-accent'
                  : 'border-transparent text-app-muted hover:border-app-border hover:bg-app-surface hover:text-app-foreground'
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
