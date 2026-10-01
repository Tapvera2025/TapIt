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
import { AuditLogPage } from '../audit/pages/AuditLogPage.js';
import { BreachQueuePage } from './breaks/BreachQueuePage.js';
import { BreakPoliciesPage } from './breaks/BreakPoliciesPage.js';
import { PayrollCyclePage } from './payroll/PayrollCyclePage.js';
import { MyPayslipsPage } from './payroll/MyPayslipsPage.js';
import { RunsPage } from './payroll/RunsPage.js';
import { SalariesPage } from './payroll/SalariesPage.js';
import { PayrollSettingsPage } from './payroll/PayrollSettingsPage.js';
import { PayrollInputsPage } from './payroll/PayrollInputsPage.js';
import { TodayPage } from './today/TodayPage.js';
import { LiveBoardPage } from './live/LiveBoardPage.js';
import { AttendancePage } from './attendance/AttendancePage.js';
import { CorrectionsPage } from './attendance/CorrectionsPage.js';
import { ShiftsPage } from './shifts/ShiftsPage.js';
import { HolidaysPage } from './holidays/HolidaysPage.js';
import { LeavePage } from './leave/LeavePage.js';
import { LeaveQueuePage } from './leave/LeaveQueuePage.js';
import { LeaveTypesPage } from './leave/LeaveTypesPage.js';
import { LeaveBalancesPage } from './leave/LeaveBalancesPage.js';
import { BiometricPage } from './biometric/BiometricPage.js';
import { TasksPage } from './tasks/index.js';
import {
  TerritoriesPage,
  TerritoryDetailsPage,
  LeadsPage,
  LeadDetailsPage,
  StalledLeadsPage,
  ReengagementSegmentsPage,
  CallbacksPage,
  CallbackDetailPage,
} from './sales/index.js';
import { RecruitmentWorkspace } from './recruitment/index.js';
import { EmployeeNotesPage, MyNotepadPage } from './notepad/index.js';

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

  useEffect(() => {
    let cancelled = false;
    void getCompanyIdentity()
      .then((nextIdentity) => {
        if (cancelled) return;
        if (nextIdentity.organization) {
          setIdentitySessionPrincipal(nextIdentity.user.id, nextIdentity.organization.id);
        }
        setIdentity(nextIdentity);
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
  // Screens that list other people need more than the holder's own record.
  const canBeyondOwn = (action: string): boolean =>
    identity.capabilities.some((item) => item.action === action && item.scope !== 'own');
  // Navigation follows the capabilities the server resolved for this session;
  // every API call is still authorized on the server.
  const canViewEmployees = isSuperAdmin || can('users:view');
  const canRequestRoleChange = !isSuperAdmin && can('access:request-role-change');
  const canViewAudit = isSuperAdmin || can('audit:view');
  const canViewTerritories = isSuperAdmin || can('territories:view');
  const canViewLeads = isSuperAdmin || can('leads:view');
  const canViewCallbacks = isSuperAdmin || can('callbacks:view');
  const canManageLeaveTypes = can('leave:manage-types');
  const canAcknowledgeLeave = can('leave:acknowledge');
  const canDecideLeave = can('leave:decide');
  const canUseLeaveQueue = canAcknowledgeLeave || canDecideLeave;
  const canViewScopedLeaveCoverage = identity.capabilities.some(
    ({ action, scope }) => action === 'leave:view' && scope !== 'own',
  );
  const userId = identity.user.id;
  const fullName = identity.user.fullName;
  const organizationTimeZone = identity.organization?.timezone ?? 'UTC';
  const hasRecruitment = identity.enabledModules.includes('recruitment');
  const isOrganization = isSuperAdmin && (
    pathname === '/company/organization' || pathname.startsWith('/company/organization/')
  );
  const isRecruitment = hasRecruitment && isHr && (
    pathname === '/company/recruitment' || pathname.startsWith('/company/recruitment/')
  );

  const pageTitles: Record<string, string> = {
    '/company/my-notepad': 'My Notepad',
    '/company/notepad': 'My Notepad',
    '/company/employee-notes': 'Employee Notes',
    '/company/sales/territories': 'Territories',
    '/company/sales/leads': 'Leads',
    '/company/sales/leads/stalled': 'Stalled Leads',
    '/company/sales/leads/re-engagement': 'Re-engagement',
    '/company/sales/callbacks': 'Callbacks',
    '/company/sales/callbacks/calendar': 'Callbacks',
    '/company/sales/callbacks/board': 'Callbacks',
    '/company/sales/callbacks/schedule': 'Callbacks',
    '/company/employees': 'Employees',
    '/company/sessions': 'Sessions & Devices',
    '/company/access': 'Access Explorer',
    '/company/access/role-changes': 'Access Explorer',
    '/company/role-change-request': 'Request Role Change',
    '/company/audit': 'Audit Log',
    '/company/breaks/queue': 'Break Breach Queue',
    '/company/breaks/policies': 'Break Policies',
    '/company/payroll/cycle': 'Payroll Cycle',
    '/company/payroll/my-payslips': 'My Payslips',
    '/company/payroll/runs': 'Payroll Runs',
    '/company/payroll/salaries': 'Salary Structures',
    '/company/payroll/inputs': 'Bonuses & Deductions',
    '/company/payroll/settings': 'Payroll Settings',
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
    '/company/leave/balances': 'Leave Balances',
    '/company/biometric': 'Biometric',
    '/company/tasks': 'Tasks',
  };
  const isEmployees = pathname === '/company/employees';
  const title = isOrganization
    ? 'Organization'
    : isRecruitment
      ? 'Recruitment'
      : pageTitles[pathname] ?? (pathname.startsWith('/company/sales/territories/') ? 'Territories' : pathname.startsWith('/company/sales/callbacks/') ? 'Callbacks' : pathname.startsWith('/company/sales/leads/') ? 'Leads' : 'Dashboard');

  function renderContent(): React.JSX.Element {
    if (pathname === '/company/my-notepad' || pathname === '/company/notepad') return <MyNotepadPage />;
    if (pathname === '/company/employee-notes') return isSuperAdmin ? <EmployeeNotesPage /> : <p role="alert" className="p-6 text-sm text-app-muted">You do not have access to employee notes.</p>;
    if (isOrganization) return <OrganizationWorkspace pathname={pathname} />;
    if (isRecruitment) return <RecruitmentWorkspace pathname={pathname} onNavigate={onNavigate} />;
    if (pathname === '/company/access' && isSuperAdmin) return <AccessExplorerPage key="person" />;
    if (pathname === '/company/access/role-changes' && isSuperAdmin) {
      return <AccessExplorerPage key="role-changes" initialTab="role-changes" />;
    }
    if (pathname === '/company/role-change-request' && canRequestRoleChange) return <RoleChangeRequestPage />;
    if (pathname === '/company/audit' && (isSuperAdmin || canViewAudit)) {
      return <AuditLogPage canManageHolds={isSuperAdmin} canExport={isSuperAdmin} />;
    }
    if (pathname === '/company/breaks/queue' && can('breaks:review-breach')) return <BreachQueuePage />;
    if (pathname === '/company/breaks/policies' && can('breaks:manage-policy')) return <BreakPoliciesPage />;
    if (pathname === '/company/payroll/cycle') return <PayrollCyclePage />;
    if (pathname === '/company/payroll/my-payslips') return <MyPayslipsPage />;
    if (pathname === '/company/payroll/runs' && can('payroll:manage')) return <RunsPage onNavigate={onNavigate} />;
    if (pathname === '/company/payroll/salaries' && can('payroll:manage')) return <SalariesPage />;
    if (pathname === '/company/payroll/inputs' && can('payroll:manage')) return <PayrollInputsPage />;
    if (pathname === '/company/payroll/settings' && can('payroll:manage-config')) return <PayrollSettingsPage />;
    if (pathname === '/company/sessions') {
      return <SessionsPage onBack={() => onNavigate('/company/dashboard')} onSignedOut={onLogout} />;
    }
    if (isEmployees) {
      return canViewEmployees
        ? (
          <EmployeesPage
            canManage={isSuperAdmin || can('users:manage')}
            isSuperAdmin={isSuperAdmin}
            canRequestRoleChange={canRequestRoleChange}
            onNavigate={onNavigate}
          />
        )
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
    if (pathname === '/company/attendance/today') return <TodayPage fullName={fullName} userId={userId} />;
    if (pathname === '/company/attendance/my') return <AttendancePage userId={userId} />;
    if (pathname === '/company/attendance/live' && canBeyondOwn('attendance:view-live')) return <LiveBoardPage />;
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
    if (pathname === '/company/leave/balances' && (canManageLeaveTypes || canViewScopedLeaveCoverage)) {
      return <LeaveBalancesPage canAdjust={canManageLeaveTypes} />;
    }
    if (pathname === '/company/leave/types') {
      return canManageLeaveTypes
        ? <LeaveTypesPage />
        : <p role="alert" className="p-6 text-sm text-app-muted">You do not have access to manage leave types.</p>;
    }
    if (pathname === '/company/biometric' && can('biometric:manage')) return <BiometricPage />;
    if (pathname === '/company/sales/territories' && canViewTerritories) return <TerritoriesPage canManage={isSuperAdmin || can('territories:manage')} onNavigate={onNavigate} />;
    const territoryDetail = pathname.match(/^\/company\/sales\/territories\/([^/]+)$/);
    if (territoryDetail && canViewTerritories) return <TerritoryDetailsPage id={territoryDetail[1]!} canManage={isSuperAdmin || can('territories:manage')} onBack={() => onNavigate('/company/sales/territories')} />;
    const callbackView = pathname === '/company/sales/callbacks/calendar' ? 'calendar' : pathname === '/company/sales/callbacks/board' ? 'board' : pathname === '/company/sales/callbacks/schedule' ? 'schedule' : 'list';
    if (pathname === '/company/sales/callbacks' || pathname === '/company/sales/callbacks/calendar' || pathname === '/company/sales/callbacks/board' || pathname === '/company/sales/callbacks/schedule') {
      if (canViewCallbacks) return <CallbacksPage view={callbackView} organizationTimezone={organizationTimeZone} onNavigate={onNavigate} />;
    }
    const callbackDetail = pathname.match(/^\/company\/sales\/callbacks\/([^/]+)$/);
    if (callbackDetail && canViewCallbacks) return <CallbackDetailPage id={callbackDetail[1]!} currentUserId={userId} onBack={() => onNavigate('/company/sales/callbacks')} onNavigate={onNavigate} />;
    if (pathname === '/company/sales/leads/stalled' && canViewLeads) return <StalledLeadsPage onBack={() => onNavigate('/company/sales/leads')} onNavigate={onNavigate} />;
    if (pathname === '/company/sales/leads/re-engagement' && canViewLeads) return <ReengagementSegmentsPage onBack={() => onNavigate('/company/sales/leads')} />;
    if (pathname === '/company/sales/leads' && canViewLeads) return <LeadsPage onNavigate={onNavigate} />;
    const leadDetail = pathname.match(/^\/company\/sales\/leads\/([^/]+)$/);
    if (leadDetail && canViewLeads) return <LeadDetailsPage id={leadDetail[1]!} currentUserId={userId} organizationTimezone={organizationTimeZone} onBack={() => onNavigate('/company/sales/leads')} />;
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
      canViewLeaveBalances={canManageLeaveTypes || canViewScopedLeaveCoverage}
      canUseLeaveQueue={canUseLeaveQueue}
      canViewEmployees={canViewEmployees}
      canViewTerritories={canViewTerritories}
      canViewLeads={canViewLeads}
      canViewCallbacks={canViewCallbacks}
      canViewLiveBoard={canBeyondOwn('attendance:view-live')}
      canReviewCorrections={can('attendance:correct')}
      canReviewBreaches={can('breaks:review-breach')}
      canManageBreakPolicies={can('breaks:manage-policy')}
      canManageShifts={can('shifts:manage')}
      canManagePayroll={can('payroll:manage')}
      canManagePayrollConfig={can('payroll:manage-config')}
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
