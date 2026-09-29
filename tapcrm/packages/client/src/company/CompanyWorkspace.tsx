import { useEffect, useState } from 'react';
import { getCompanyIdentity, type CompanyIdentity } from './api/companyApi.js';
import { setIdentitySessionPrincipal } from '../identity/api/authApi.js';
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
import { BreachQueuePage } from './breaks/BreachQueuePage.js';
import { BreakPoliciesPage } from './breaks/BreakPoliciesPage.js';
import { PayrollCyclePage } from './payroll/PayrollCyclePage.js';
import { MyPayslipsPage } from './payroll/MyPayslipsPage.js';
import { RunsPage } from './payroll/RunsPage.js';
import { TodayPage } from './today/TodayPage.js';
import { LiveBoardPage } from './live/LiveBoardPage.js';
import { AttendancePage } from './attendance/AttendancePage.js';
import { CorrectionsPage } from './attendance/CorrectionsPage.js';
import { ShiftsPage } from './shifts/ShiftsPage.js';
import { HolidaysPage } from './holidays/HolidaysPage.js';
import { LeavePage } from './leave/LeavePage.js';
import { LeaveQueuePage } from './leave/LeaveQueuePage.js';
import { LeaveTypesPage } from './leave/LeaveTypesPage.js';
import { BiometricPage } from './biometric/BiometricPage.js';

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
    let cancelled = false;
    void getCompanyIdentity()
      .then((nextIdentity) => {
        if (cancelled) return;
        if (nextIdentity.organization) {
          setIdentitySessionPrincipal(nextIdentity.user.id, nextIdentity.organization.id);
        }
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
      .catch((cause) => {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : 'Unable to load company workspace.');
      });
    return () => { cancelled = true; };
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
  const canManageLeaveTypes = identity.capabilities.some(
    ({ action }) => action === 'leave:manage-types',
  );
  const canAcknowledgeLeave = identity.capabilities.some(
    ({ action }) => action === 'leave:acknowledge',
  );
  const canDecideLeave = identity.capabilities.some(
    ({ action }) => action === 'leave:decide',
  );
  const canUseLeaveQueue = canAcknowledgeLeave || canDecideLeave;
  const canViewScopedLeaveCoverage = identity.capabilities.some(
    ({ action, scope }) => action === 'leave:view' && scope !== 'own',
  );
  const userId = identity.user.id;
  const organizationTimeZone = identity.organization?.timezone ?? 'UTC';

  const isOrganization =
    isSuperAdmin &&
    (pathname === '/company/organization' ||
      pathname.startsWith('/company/organization/'));

  const PAGE_TITLES: Record<string, string> = {
    '/company/employees': 'Employees',
    '/company/sessions': 'Sessions & Devices',
    '/company/access': 'Access Explorer',
    '/company/role-change-request': 'Request Role Change',
    '/company/audit': 'Audit Log',
    '/company/breaks/queue': 'Break Breach Queue',
    '/company/breaks/policies': 'Break Policies',
    '/company/payroll/cycle': 'Payroll Cycle',
    '/company/payroll/my-payslips': 'My Payslips',
    '/company/payroll/runs': 'Payroll Runs',
    '/company/geofencing': 'Geofencing',
    '/company/attendance/today': 'Today',
    '/company/attendance/my': 'My Attendance',
    '/company/attendance/live': 'Workforce Board',
    '/company/attendance/corrections': 'Corrections',
    '/company/shifts': 'Shifts',
    '/company/holidays': 'Holidays',
    '/company/leave/my': 'My Leave',
    '/company/leave/queue': 'Leave Queue',
    '/company/leave/types': 'Leave Types',
    '/company/biometric': 'Biometric',
  };

  const title = isOrganization
    ? 'Organization'
    : PAGE_TITLES[pathname] ?? 'Dashboard';

  function renderContent(): React.JSX.Element {
    if (isOrganization) return <OrganizationWorkspace pathname={pathname} />;
    if (pathname === '/company/access' && isSuperAdmin) return <AccessExplorerPage />;
    if (pathname === '/company/role-change-request' && !isSuperAdmin) return <RoleChangeRequestPage />;
    if (pathname === '/company/audit' && (isSuperAdmin || canViewAudit))
      return <AuditLogPage canManageHolds={isSuperAdmin} canExport={isSuperAdmin} />;
    if (pathname === '/company/breaks/queue' && isSuperAdmin) return <BreachQueuePage />;
    if (pathname === '/company/breaks/policies' && isSuperAdmin) return <BreakPoliciesPage />;
    if (pathname === '/company/payroll/cycle') return <PayrollCyclePage />;
    if (pathname === '/company/payroll/my-payslips') return <MyPayslipsPage />;
    if (pathname === '/company/payroll/runs' && isSuperAdmin) return <RunsPage />;
    if (pathname === '/company/sessions')
      return <SessionsPage onBack={() => onNavigate('/company/dashboard')} onSignedOut={onLogout} />;
    if (pathname === '/company/employees' && isSuperAdmin) return <EmployeesPage />;
    if (pathname === '/company/geofencing')
      return <GeofencingPage onBack={() => onNavigate('/company/dashboard')} />;
    // Attendance
    if (pathname === '/company/attendance/today') return <TodayPage />;
    if (pathname === '/company/attendance/my') return <AttendancePage userId={userId} />;
    if (pathname === '/company/attendance/live' && isSuperAdmin) return <LiveBoardPage />;
    if (pathname === '/company/attendance/corrections') return <CorrectionsPage />;
    // Shifts & Leave
    if (pathname === '/company/shifts' && isSuperAdmin) return <ShiftsPage />;
    if (pathname === '/company/holidays') return <HolidaysPage />;
    if (pathname === '/company/leave/my') return <LeavePage userId={userId} organizationTimeZone={organizationTimeZone} />;
    if (pathname === '/company/leave/queue' && canUseLeaveQueue)
      return (
        <LeaveQueuePage
          canAcknowledge={canAcknowledgeLeave}
          canDecide={canDecideLeave}
          canViewScopedCoverage={canViewScopedLeaveCoverage}
        />
      );
    if (pathname === '/company/leave/types') {
      return canManageLeaveTypes ? (
        <LeaveTypesPage />
      ) : (
        <p role="alert" className="p-6 text-sm text-app-muted">
          You do not have access to manage leave types.
        </p>
      );
    }
    if (pathname === '/company/biometric' && isSuperAdmin) return <BiometricPage />;

    return <DashboardPage identity={identity!} onNavigate={onNavigate} />;
  }

  const content = renderContent();
  return (
    <CompanyLayout
      pathname={pathname}
      identity={identity.user}
      organizationName={identity.organization?.name ?? null}
      accountType={identity.user.accountType}
      canRequestRoleChange={canRequestRoleChange}
      canViewAudit={canViewAudit}
      canManageLeaveTypes={canManageLeaveTypes}
      canUseLeaveQueue={canUseLeaveQueue}
      title={title}
      onNavigate={onNavigate}
      onLogout={onLogout}
    >
      {content}
    </CompanyLayout>
  );
}
