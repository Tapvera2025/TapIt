import { WorkspacePageContainer } from '../../ui/index.js';
import {
  useCompanyPageMetadataValue,
  useRegisteredNavigation,
  type CompanyPageMetadata,
} from './CompanyNavbarContext.js';
import { breadcrumbTrail } from './breadcrumbs.js';
import { CompanyBreadcrumbs } from './CompanyBreadcrumbs.js';
import { useMemo } from 'react';
import { CompanyHeroUtilityCapsule } from './CompanyHeroUtilityCapsule.js';

const DESCRIPTION_BY_TITLE: Readonly<Record<string, string>> = {
  Accounting: 'Manage workspace accounts, ledgers and financial records.',
  Clients: 'Manage client relationships, meetings and delivery context.',
  Corrections: 'Review attendance correction requests and decisions.',
  Employees: 'Manage company workforce and employee information.',
  Holidays: 'Review the organization holiday calendar and planned days off.',
  Messages: 'Manage company conversations and communication.',
  Projects: 'Manage company projects and their progress.',
  Tasks: 'Manage and track assigned work.',
  'My Attendance': 'Review your attendance history and work calendar.',
  'My Leave': 'Apply for leave, review requests and check available balances.',
  'My Todo': 'Plan your day, organize upcoming work and stay on track.',
  'My Notepad': 'Keep personal notes and useful workspace information close by.',
  Recruitment: 'Manage recruitment, candidates and employee onboarding.',
  'Sales Overview': 'Monitor sales activity, pipeline progress and team performance.',
  Overview: 'Monitor sales activity, pipeline progress and team performance.',
  Setup: 'Configure Sales routing, lead sources and calling integrations.',
  'All Leads': 'Work with leads across your company workspace.',
  'Lead Pool': 'Review inbound leads waiting for a claim.',
  'Inactive Leads': 'Review leads that need renewed attention.',
  'Follow-up Required': 'Keep follow-ups moving across your lead pipeline.',
  'Needs Review': 'Review leads waiting for your team\'s attention.',
  'Imported Leads': 'Review imported leads and their source data.',
  'Team overview': 'Review team sales activity and current workload.',
  Pipeline: 'Manage your Sales pipeline and active deals.',
  'My calls': 'Review your call activity across the company workspace.',
  'Call log': 'Review calls across your company workspace.',
  'Assigned lead calls': 'Review calls assigned to your lead portfolio.',
  'Call integrations': 'Manage connected calling platforms and integrations.',
  'Territories & routing': 'Configure territories and routing for incoming leads.',
};

function categoryForPath(pathname: string): string {
  if (pathname.includes('/recruitment') || pathname.includes('/interviews')) return 'Human resources';
  if (pathname.includes('/organization') || pathname.includes('/employees')) return 'Organization';
  if (pathname.includes('/attendance') || pathname.includes('/leave') || pathname.includes('/shifts') || pathname.includes('/holidays')) return 'People operations';
  if (pathname.includes('/sales')) return 'Sales';
  if (pathname.includes('/payroll') || pathname.includes('/finance')) return 'Finance';
  if (pathname.includes('/projects') || pathname.includes('/clients') || pathname.includes('/meetings')) return 'Company operations';
  if (pathname.includes('/messages')) return 'Communication';
  if (pathname.includes('/todo') || pathname.includes('/tasks') || pathname.includes('/notepad')) return 'Productivity';
  if (pathname.includes('/access') || pathname.includes('/audit') || pathname.includes('/sessions')) return 'Identity & access';
  return 'Company operations';
}

export function defaultCompanyPageMetadata({
  pathname,
  title,
  fullName,
  isSuperAdmin,
}: {
  readonly pathname: string;
  readonly title: string;
  readonly fullName: string;
  readonly isSuperAdmin: boolean;
}): CompanyPageMetadata {
  const isDashboard = pathname === '/company/dashboard';
  const resolvedTitle = isDashboard ? (isSuperAdmin ? 'Admin dashboard' : 'Today at a glance') : title;
  const description = isDashboard
    ? (isSuperAdmin ? 'Workforce, sales and requests in one live view.' : `${fullName}'s operational workboard.`)
    : DESCRIPTION_BY_TITLE[resolvedTitle] ?? `Work with ${resolvedTitle.toLowerCase()} across your company workspace.`;

  return {
    eyebrow: isDashboard ? 'Company operations' : categoryForPath(pathname),
    title: resolvedTitle,
    description,
  };
}

export function CompanyPageHero({
  pathname,
  onNavigate,
  homePath = '/company/dashboard',
  showGroup = true,
}: {
  readonly pathname: string;
  readonly onNavigate: (path: string) => void;
  /** Where the Home crumb goes: the portal's landing page. */
  readonly homePath?: string;
  /** Off for the small fixed menus (platform) that have no meaningful groups. */
  readonly showGroup?: boolean;
}): React.JSX.Element {
  const metadata = useCompanyPageMetadataValue();
  const groups = useRegisteredNavigation();
  const title = metadata?.title;
  const crumbs = useMemo(
    () => breadcrumbTrail({ groups, pathname, pageTitle: title, homePath, showGroup }),
    [groups, pathname, title, homePath, showGroup],
  );
  if (!metadata) return <></>;

  return (
    <div className="company-page-hero-desktop hidden xl:block">
      <WorkspacePageContainer>
        {/* One row: where you are on the left, the page's dynamic controls on the right. */}
        <div className="company-topbar">
          <CompanyBreadcrumbs crumbs={crumbs} onNavigate={onNavigate} />
          <div className="company-page-hero-utility">
            <CompanyHeroUtilityCapsule />
          </div>
        </div>
        <section className="company-page-hero" aria-labelledby="company-page-hero-title">
          <h1 id="company-page-hero-title">{metadata.title}</h1>
          <p className="company-page-hero-description">{metadata.description}</p>
        </section>
      </WorkspacePageContainer>
    </div>
  );
}
