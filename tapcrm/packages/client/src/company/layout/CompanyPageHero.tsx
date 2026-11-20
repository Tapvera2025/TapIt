import { WorkspacePageContainer } from '../../ui/index.js';
import {
  useCompanyPageDescriptionOverride,
  useCompanyPageMetadataValue,
  usePublishHeadingTitle,
  useRegisteredNavigation,
  type CompanyPageMetadata,
} from './CompanyNavbarContext.js';
import { resolvePageHeading } from './breadcrumbs.js';
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
  'My Profile': 'Your personal details, education, experience and documents.',
  Recruitment: 'Manage recruitment, candidates and employee onboarding.',
  'Sales Overview': 'Monitor sales activity, pipeline progress and team performance.',
  Overview: 'Monitor sales activity, pipeline progress and team performance.',
  Setup: 'Configure Sales routing, lead sources and calling integrations.',
  'All Leads': 'Work with leads across your company workspace.',
  'Lead Pool': 'Review inbound leads waiting for a claim.',
  'Lead Pool (Live)': 'Review time-sensitive inbound leads waiting for a claim.',
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
  Departments: 'Manage departments and who leads each one.',
  Teams: 'Create teams and manage their members.',
  Positions: 'Review the position hierarchy and what each position can do.',
  Designations: 'Manage job titles and specializations. These do not grant authorization.',
  Reporting: 'See and change who reports to whom.',
  'Org Chart': 'Explore the company reporting structure.',
  'Client meetings': 'Schedule client meetings and see what needs a response.',
  'Manage Social Media': 'Plan, publish and review social media posts for your clients.',
  'My Work': 'Your leads, callbacks and live calls in one place.',
  Approvals: 'Review and decide the requests waiting on you.',
  Reports: 'Sales totals and forecasts for the period.',
  Callbacks: 'Schedule and follow up on promised callbacks.',
  Calls: 'Review calls across the team.',
  Today: 'Punch in and out, and follow today\'s breaks and activity.',
  'Employee Wise': 'Review attendance employee by employee.',
  'Attendance Report': 'Attendance status and trends across the company.',
  'Daily Late Report': 'See who arrived late today, and by how much.',
  'Leave Queue': 'Review and decide leave requests.',
  'Leave Balances': 'Check and adjust each employee\'s leave balances.',
  'Leave Types': 'Configure the leave types and rules your company offers.',
  'My Advances': 'Request a salary advance and track its repayment.',
  'Advance Requests': 'Review advance requests and create manual advances.',
  'My Expenses': 'Submit expense claims and track their approval.',
  'Expense Approvals': 'Review and approve expense claims.',
  'My Payslips': 'View and download your payslips.',
  'Payroll Runs': 'Prepare, review and publish monthly payroll.',
  'Salary Structures': 'Set the salary components for each employee.',
  'Payroll Settings': 'Configure payroll rules, components and cycles.',
  'Sessions & Devices': 'Review where your account is signed in, and sign out other devices.',
  'Access Explorer': 'See what each person can access, and why.',
  'Audit Log': 'Review a record of who did what across the workspace.',
  Geofencing: 'Define the locations employees can punch in from.',
  'SEO Dashboard': 'Track your websites\' search performance, rankings and site health.',
  Settings: 'Choose your appearance and display mode, and manage workspace settings.',
};

/** For titles that exist in several groups (every module has an "Overview"), keyed "Group/Title". */
const DESCRIPTION_BY_GROUP_AND_TITLE: Readonly<Record<string, string>> = {
  'Sales/Overview': 'Monitor sales activity, pipeline progress and team performance.',
  'Organization/Overview': 'The organization at a glance: departments, teams, positions and people.',
  'Recruitment/Overview': 'Hiring pipeline, upcoming interviews and onboarding at a glance.',
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

/** The generic description for a page that supplies none of its own. */
export function descriptionForTitle(title: string, groupLabel?: string | null): string {
  return (
    (groupLabel ? DESCRIPTION_BY_GROUP_AND_TITLE[`${groupLabel}/${title}`] : undefined) ??
    DESCRIPTION_BY_TITLE[title] ??
    `Work with ${title.toLowerCase()} across your company workspace.`
  );
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
  const descriptionOverride = useCompanyPageDescriptionOverride();
  const heading = useMemo(
    () =>
      resolvePageHeading({
        groups,
        pathname,
        fallbackTitle: metadata?.title ?? '',
        lockTitle: metadata?.lockTitle ?? false,
        homePath,
        showGroup,
      }),
    [groups, pathname, metadata?.title, metadata?.lockTitle, homePath, showGroup],
  );
  usePublishHeadingTitle(heading.title);
  if (!metadata) return <></>;

  // One description, in order of authority: what the page itself says, then what
  // it registered with its metadata, then a generic line for the (menu) title.
  const description =
    descriptionOverride ??
    (metadata.custom || !heading.inMenu ? metadata.description : descriptionForTitle(heading.title, heading.groupLabel));

  return (
    <>
      {/* Phones and tablets: the page has no banner, but the trail still shows where you are. */}
      <div className="company-mobile-crumbs xl:hidden">
        <WorkspacePageContainer>
          <div className="pt-3">
            <CompanyBreadcrumbs crumbs={heading.crumbs} onNavigate={onNavigate} />
          </div>
          {metadata.extensionOnMobile && metadata.extension && (
            <div className="company-mobile-actions flex flex-wrap items-center gap-2 pt-2">{metadata.extension}</div>
          )}
        </WorkspacePageContainer>
      </div>
    <div className="company-page-hero-desktop hidden xl:block">
      <WorkspacePageContainer>
        {/* One row: where you are on the left, the page's dynamic controls on the right. */}
        <div className="company-topbar">
          <CompanyBreadcrumbs crumbs={heading.crumbs} onNavigate={onNavigate} />
          <div className="company-page-hero-utility">
            <CompanyHeroUtilityCapsule />
          </div>
        </div>
        <section className="company-page-hero" aria-labelledby="company-page-hero-title">
          <h1 id="company-page-hero-title">{heading.title}</h1>
          <p className="company-page-hero-description">{description}</p>
        </section>
      </WorkspacePageContainer>
    </div>
    </>
  );
}
