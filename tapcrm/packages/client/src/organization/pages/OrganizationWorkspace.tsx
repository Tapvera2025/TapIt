import { OrganizationOverview } from './OrganizationOverview.js';
import { DepartmentsPage } from './DepartmentsPage.js';
import { TeamsPage } from './TeamsPage.js';
import { PositionsPage } from './PositionsPage.js';
import { DesignationsPage } from './DesignationsPage.js';
import { ReportingPage } from './ReportingPage.js';
import { OrgChartPage } from './OrgChartPage.js';

export function OrganizationWorkspace({
  pathname,
}: {
  pathname: string;
}): React.JSX.Element {
  if (pathname === '/company/organization/departments') return <DepartmentsPage />;
  if (pathname === '/company/organization/teams') return <TeamsPage />;
  if (pathname === '/company/organization/positions') return <PositionsPage />;
  if (pathname === '/company/organization/designations') return <DesignationsPage />;
  if (pathname === '/company/organization/reporting') return <ReportingPage />;
  if (pathname === '/company/organization/org-chart') return <OrgChartPage />;
  return (
    <OrganizationOverview
      onNavigate={(path) => {
        window.history.pushState({}, '', path);
        window.dispatchEvent(new PopStateEvent('popstate'));
      }}
    />
  );
}
