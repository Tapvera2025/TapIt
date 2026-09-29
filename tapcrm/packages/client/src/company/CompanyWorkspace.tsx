import { useEffect, useState } from 'react';
import { getCompanyEmployees, getCompanyIdentity, type CompanyIdentity } from './api/companyApi.js';
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
import { TasksPage } from './tasks/index.js';
import { RecruitmentWorkspace } from './recruitment/index.js';

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
  const [canViewEmployees, setCanViewEmployees] = useState(false);
  const [employeesAccessChecked, setEmployeesAccessChecked] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void getCompanyIdentity()
      .then((nextIdentity) => {
        if (cancelled) return;
        if (nextIdentity.organization) {
          setIdentitySessionPrincipal(nextIdentity.user.id, nextIdentity.organization.id);
        }
        setIdentity(nextIdentity);

        if (nextIdentity.user.accountType === 'super-admin') {
          setCanViewEmployees(true);
          setEmployeesAccessChecked(true);
        } else if (nextIdentity.user.accountType === 'employee') {
          // This only controls directory navigation; the directory API remains
          // authoritative for every read and mutation.
          void getCompanyEmployees()
            .then(() => { if (!cancelled) setCanViewEmployees(true); })
            .catch(() => { if (!cancelled) setCanViewEmployees(false); })
            .finally(() => { if (!cancelled) setEmployeesAccessChecked(true); });

          void getRoleChangeRequestAccess()
            .then(() => { if (!cancelled) setCanRequestRoleChange(true); })
            .catch(() => { if (!cancelled) setCanRequestRoleChange(false); });

          void getAuditEntries({ limit: 1 })
            .then(() => { if (!cancelled) setCanViewAudit(true); })
            .catch(() => { if (!cancelled) setCanViewAudit(false); });
        }
      })
      .catch((cause) => {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : 'Unable to load company workspace.');
      });
    return () => { cancelled = true; };
  }, []);

  if (error) {
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
  }

  if (!identity) {
    return (
      <div className="grid min-h-screen place-items-center bg-app-background text-sm text-app-muted">
        Loading company workspace...
      </div>
    );
  }

  const isSuperAdmin = identity.user.accountType === 'super-admin';
  const isHr = isSuperAdmin || (
    identity.user.accountType === 'employee' && (
      identity.user.departmentCode?.toLowerCase().includes('hr') ||
      identity.user.departmentName?.toLowerCase().includes('human resources') ||
      identity.user.departmentName?.toLowerCase().includes('people') ||
      identity.user.positionCode?.toLowerCase().startsWith('hr')
    )
  );
  const can = (action: string): boolean => identity.capabilities.some((item) => item.action === action);
  const canManageLeaveTypes = can('leave:manage-types');
  const canAcknowledgeLeave = can('leave:acknowledge');
  const canDecideLeave = can('leave:decide');
  const canUseLeaveQueue = canAcknowledgeLeave || canDecideLeave;
  const canViewScopedLeaveCoverage = identity.capabilities.some(
    ({ action, scope }) => action === 'leave:view' && scope !== 'own',
  );
  const userId = identity.user.id;
  const organizationTimeZone = identity.organization?.timezone ?? 'UTC';
  const hasRecruitment = identity.enabledModules.includes('recruitment');
  const isOrganization = isSuperAdmin && (
    pathname === '/company/organization' || pathname.startsWith('/company/organization/')
  );
  const isRecruitment = hasRecruitment && isHr && (
    pathname === '/company/recruitment' || pathname.startsWith('/company/recruitment/')
  );

  const pageTitles: Record<string, string> = {
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
    '/company/tasks': 'Tasks',
  };
  const isEmployees = pathname === '/company/employees';
  const title = isOrganization
    ? 'Organization'
    : isRecruitment
      ? 'Recruitment'
      : pageTitles[pathname] ?? 'Dashboard';

  function renderContent(): React.JSX.Element {
    if (isOrganization) return <OrganizationWorkspace pathname={pathname} />;
    if (isRecruitment) return <RecruitmentWorkspace pathname={pathname} onNavigate={onNavigate} />;
    if (pathname === '/company/access' && isSuperAdmin) return <AccessExplorerPage />;
    if (pathname === '/company/role-change-request' && !isSuperAdmin) return <RoleChangeRequestPage />;
    if (pathname === '/company/audit' && (isSuperAdmin || canViewAudit)) {
      return <AuditLogPage canManageHolds={isSuperAdmin} canExport={isSuperAdmin} />;
    }
    if (pathname === '/company/breaks/queue' && can('breaks:review-breach')) return <BreachQueuePage />;
    if (pathname === '/company/breaks/policies' && can('breaks:manage-policy')) return <BreakPoliciesPage />;
    if (pathname === '/company/payroll/cycle') return <PayrollCyclePage />;
    if (pathname === '/company/payroll/my-payslips') return <MyPayslipsPage />;
    if (pathname === '/company/payroll/runs' && can('payroll:manage')) return <RunsPage />;
    if (pathname === '/company/sessions') {
      return <SessionsPage onBack={() => onNavigate('/company/dashboard')} onSignedOut={onLogout} />;
    }
    if (isEmployees) {
      return isSuperAdmin || isHr || (employeesAccessChecked && canViewEmployees)
        ? <EmployeesPage />
        : (
          <div className="grid min-h-[60vh] place-items-center p-6 text-center">
            <div>
              <h1 className="font-display text-2xl font-bold">Access Restricted</h1>
              <p className="mt-2 text-sm text-app-muted">Employee directory is restricted to authorized personnel.</p>
            </div>
          </div>
        );
    }
    if (pathname.startsWith('/company/organization/')) return <OrganizationWorkspace pathname={pathname} />;
    if (pathname === '/company/geofencing') {
      return <GeofencingPage onBack={() => onNavigate('/company/dashboard')} />;
    }
    if (pathname === '/company/tasks') {
      return <TasksPage isSuperAdmin={isSuperAdmin} currentUserId={userId} />;
    }
    if (pathname === '/company/attendance/today') return <TodayPage />;
    if (pathname === '/company/attendance/my') return <AttendancePage userId={userId} />;
    if (pathname === '/company/attendance/live' && can('attendance:view-live')) return <LiveBoardPage />;
    if (pathname === '/company/attendance/corrections' && can('attendance:correct')) return <CorrectionsPage />;
    if (pathname === '/company/shifts' && can('shifts:manage')) return <ShiftsPage />;
    if (pathname === '/company/holidays') return <HolidaysPage />;
    if (pathname === '/company/leave/my') {
      return <LeavePage userId={userId} organizationTimeZone={organizationTimeZone} />;
    }
    if (pathname === '/company/leave/queue' && canUseLeaveQueue) {
      return (
        <LeaveQueuePage
          canAcknowledge={canAcknowledgeLeave}
          canDecide={canDecideLeave}
          canViewScopedCoverage={canViewScopedLeaveCoverage}
        />
      );
    }
    if (pathname === '/company/leave/types') {
      return canManageLeaveTypes
        ? <LeaveTypesPage />
        : <p role="alert" className="p-6 text-sm text-app-muted">You do not have access to manage leave types.</p>;
    }
    if (pathname === '/company/biometric' && can('biometric:manage')) return <BiometricPage />;
    return <DashboardPage identity={identity!} onNavigate={onNavigate} />;
  }

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
      canViewEmployees={canViewEmployees}
      canViewLiveBoard={can('attendance:view-live')}
      canReviewCorrections={can('attendance:correct')}
      canReviewBreaches={can('breaks:review-breach')}
      canManageBreakPolicies={can('breaks:manage-policy')}
      canManageShifts={can('shifts:manage')}
      canManagePayroll={can('payroll:manage')}
      canManageBiometric={can('biometric:manage')}
      isHr={Boolean(isHr)}
      hasRecruitment={hasRecruitment}
      title={title}
      onNavigate={onNavigate}
      onLogout={onLogout}
    >
      {renderContent()}
    </CompanyLayout>
  );
}
