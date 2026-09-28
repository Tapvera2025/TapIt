import { useEffect, useState } from 'react';
import { getCompanyIdentity, type CompanyIdentity } from './api/companyApi.js';
import { CompanyLayout } from './layout/CompanyLayout.js';
import { DashboardPage } from './dashboard/DashboardPage.js';
import { EmployeesPage } from './employees/EmployeesPage.js';
import { SessionsPage } from '../identity/pages/SessionsPage.js';
import { GeofencingPage } from '../identity/pages/GeofencingPage.js';
import { OrganizationWorkspace } from '../organization/index.js';
import { AccessExplorerPage } from '../access-management/pages/AccessExplorerPage.js';
import { RoleChangeRequestPage } from '../access-management/pages/RoleChangeRequestPage.js';
import { getRoleChangeRequestAccess } from '../access-management/api/accessApi.js';
import { getAuditEntries } from '../audit/api/auditApi.js';
import { AuditLogPage } from '../audit/pages/AuditLogPage.js';
import { EmployeeBreakView } from './breaks/EmployeeBreakView.js';
import { BreachQueuePage } from './breaks/BreachQueuePage.js';
import { PayrollCyclePage } from './payroll/PayrollCyclePage.js';
import { MyPayslipsPage } from './payroll/MyPayslipsPage.js';
import { RunsPage } from './payroll/RunsPage.js';

export function CompanyWorkspace({
  pathname,
  onNavigate,
  onLogout,
}: {
  pathname: string;
  onNavigate: (path: string) => void;
  onLogout: () => void;
}): React.JSX.Element {
  const [identity, setIdentity] = useState<CompanyIdentity | null>(null);
  const [error, setError] = useState('');
  const [canRequestRoleChange, setCanRequestRoleChange] = useState(false);
  const [canViewAudit, setCanViewAudit] = useState(false);
  useEffect(() => {
    void getCompanyIdentity()
      .then((nextIdentity) => {
        setIdentity(nextIdentity);
        if (nextIdentity.user.accountType === 'employee') {
          void getRoleChangeRequestAccess()
            .then(() => setCanRequestRoleChange(true))
            .catch(() => setCanRequestRoleChange(false));
          void getAuditEntries({ limit: 1 })
            .then(() => setCanViewAudit(true))
            .catch(() => setCanViewAudit(false));
        }
      })
      .catch((cause) =>
        setError(
          cause instanceof Error ? cause.message : 'Unable to load company workspace.',
        ),
      );
  }, []);
  if (error)
    return (
      <div className="grid min-h-screen place-items-center bg-app-background p-6 text-center text-app-foreground">
        <div>
          <p className="text-app-danger">{error}</p>
          <button
            type="button"
            onClick={onLogout}
            className="mt-4 rounded-lg bg-app-accent px-4 py-2.5 text-sm font-bold text-app-on-accent"
          >
            Return to login
          </button>
        </div>
      </div>
    );
  if (!identity)
    return (
      <div className="grid min-h-screen place-items-center bg-app-background text-sm text-app-muted">
        Loading company workspace...
      </div>
    );
  const isSuperAdmin = identity.user.accountType === 'super-admin';
  const isOrganization =
    isSuperAdmin &&
    (pathname === '/company/organization' ||
      pathname.startsWith('/company/organization/'));
  const isAccess = pathname === '/company/access';
  const isRoleChangeRequest = pathname === '/company/role-change-request';
  const isAudit = pathname === '/company/audit';
  const isBreachQueue = pathname === '/company/breaks/queue';
  const isPayrollCycle = pathname === '/company/payroll/cycle';
  const isMyPayslips = pathname === '/company/payroll/my-payslips';
  const isPayrollRuns = pathname === '/company/payroll/runs';
  const title = isOrganization
    ? 'Organization'
    : pathname === '/company/employees'
      ? 'Employees'
      : pathname === '/company/sessions'
        ? 'Sessions & Devices'
        : isAccess
          ? 'Access Explorer'
          : isRoleChangeRequest
            ? 'Request Role Change'
            : isAudit
              ? 'Audit Log'
            : isBreachQueue
              ? 'Break Breach Queue'
            : isPayrollCycle
              ? 'Payroll Cycle'
            : isMyPayslips
              ? 'My Payslips'
            : isPayrollRuns
              ? 'Payroll Runs'
            : pathname === '/company/geofencing'
              ? 'Geofencing'
              : 'Dashboard';
  const content = isOrganization ? (
    <OrganizationWorkspace pathname={pathname} />
  ) : isAccess && isSuperAdmin ? (
    <AccessExplorerPage />
  ) : isRoleChangeRequest && !isSuperAdmin ? (
    <RoleChangeRequestPage />
  ) : isAudit && (isSuperAdmin || canViewAudit) ? (
    <AuditLogPage canManageHolds={isSuperAdmin} canExport={isSuperAdmin} />
  ) : isBreachQueue && isSuperAdmin ? (
    <BreachQueuePage />
  ) : isPayrollCycle ? (
    <PayrollCyclePage />
  ) : isMyPayslips ? (
    <MyPayslipsPage />
  ) : isPayrollRuns && isSuperAdmin ? (
    <RunsPage />
  ) : pathname === '/company/sessions' ? (
    <SessionsPage
      onBack={() => onNavigate('/company/dashboard')}
      onSignedOut={onLogout}
    />
  ) : !isSuperAdmin ? (
    <EmployeeBreakView />
  ) : pathname === '/company/employees' ? (
    <EmployeesPage />
  ) : pathname === '/company/geofencing' ? (
    <GeofencingPage onBack={() => onNavigate('/company/dashboard')} />
  ) : (
    <DashboardPage identity={identity} onNavigate={onNavigate} />
  );
  return (
    <CompanyLayout
      pathname={pathname}
      identity={identity.user}
      organizationName={identity.organization?.name ?? null}
      accountType={identity.user.accountType}
      canRequestRoleChange={canRequestRoleChange}
      canViewAudit={canViewAudit}
      title={title}
      onNavigate={onNavigate}
      onLogout={onLogout}
    >
      {content}
    </CompanyLayout>
  );
}
