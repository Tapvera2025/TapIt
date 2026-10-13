import { Component, useEffect, useState, type ErrorInfo, type ReactNode } from 'react';
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
import { EmployeeWisePage } from './attendance/EmployeeWisePage.js';
import { AttendanceReportPage } from './attendance/AttendanceReportPage.js';
import { DailyLateReportPage } from './attendance/DailyLateReportPage.js';
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
  HandoverPage,
} from './sales/index.js';
import { RecruitmentWorkspace } from './recruitment/index.js';
import { EmployeeNotesPage, MyNotepadPage } from './notepad/index.js';
import { MessagesPage } from '../chat/index.js';
import { ClientsPage } from '../clients/index.js';
import { ProjectDetailPage, ProjectsPage } from '../projects/index.js';
import { MyTodoPage } from './todo/index.js';
import { SettingsPage } from './settings/SettingsPage.js';
import { WorkspaceSkeleton } from '../ui/components.js';
import { AdvanceRequestsPage, MyAdvancesPage } from './advance/AdvancePages.js';
import { PenaltiesPage } from './penalties/PenaltiesPage.js';
import { MyPenaltiesPage } from './penalties/MyPenaltiesPage.js';
import { ExpenseApprovalsPage, MyExpensesPage } from './expenses/ExpensesPages.js';
import { MyTaPage, TaManagementPage } from './ta/TaPages.js';

export function CompanyWorkspace({
  pathname: rawPathname,
  onNavigate,
  onLogout,
}: {
  pathname: string;
  onNavigate: (path: string) => void;
  onLogout: () => void;
}): React.JSX.Element {
  const pathname = (rawPathname.split('?')[0] ?? rawPathname).replace(/\/+$/, '') || '/';
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
        setError(
          cause instanceof Error ? cause.message : 'Unable to load company workspace.',
        );
      });
    return () => {
      cancelled = true;
    };
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
    return <WorkspaceSkeleton pathname={pathname} />;
  }

  const isSuperAdmin = identity.user.accountType === 'super-admin';
  const isHr =
    isSuperAdmin ||
    (identity.user.accountType === 'employee' &&
      (identity.user.departmentCode?.toLowerCase().includes('hr') ||
        identity.user.departmentName?.toLowerCase().includes('human resources') ||
        identity.user.departmentName?.toLowerCase().includes('people') ||
        identity.user.positionCode?.toLowerCase().startsWith('hr')));
  const can = (action: string): boolean =>
    identity.capabilities.some((item) => item.action === action);
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
  const canViewHandovers = isSuperAdmin || can('handovers:view');
  const canViewChat = isSuperAdmin || can('chat:view');
  const canViewClients = isSuperAdmin || can('clients:view');
  const canViewProjects = isSuperAdmin || can('projects:view');
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
  const isOrganization =
    isSuperAdmin &&
    (pathname === '/company/organization' ||
      pathname.startsWith('/company/organization/'));
  const isRecruitment =
    hasRecruitment &&
    isHr &&
    (pathname === '/company/recruitment' || pathname.startsWith('/company/recruitment/'));

  const isEmployees = pathname === '/company/employees';

  function renderContent(): React.JSX.Element {
    if (
      pathname === '/company/expenses/mine' &&
      (isSuperAdmin || isHr || can('payables:claim'))
    )
      return <MyExpensesPage />;
    if (
      pathname === '/company/expenses/approvals' &&
      (isSuperAdmin || isHr || canBeyondOwn('payables:approve-claim'))
    )
      return <ExpenseApprovalsPage />;
    if (pathname === '/company/todo' || pathname === '/company/my-todo')
      return <MyTodoPage />;
    if (pathname === '/company/my-notepad' || pathname === '/company/notepad')
      return <MyNotepadPage />;
    if (pathname === '/company/employee-notes')
      return isSuperAdmin ? (
        <EmployeeNotesPage />
      ) : (
        <p role="alert" className="p-6 text-sm text-app-muted">
          You do not have access to employee notes.
        </p>
      );
    if (isOrganization) return <OrganizationWorkspace pathname={pathname} />;
    if (isRecruitment)
      return <RecruitmentWorkspace pathname={pathname} onNavigate={onNavigate} />;
    if (pathname === '/company/access' && isSuperAdmin)
      return <AccessExplorerPage key="person" />;
    if (pathname === '/company/access/role-changes' && isSuperAdmin) {
      return <AccessExplorerPage key="role-changes" initialTab="role-changes" />;
    }
    if (pathname === '/company/role-change-request' && canRequestRoleChange)
      return <RoleChangeRequestPage />;
    if (pathname === '/company/audit' && (isSuperAdmin || canViewAudit)) {
      return <AuditLogPage canManageHolds={isSuperAdmin} canExport={isSuperAdmin} />;
    }
    if (pathname === '/company/breaks/queue' && can('breaks:review-breach'))
      return <BreachQueuePage />;
    if (pathname === '/company/breaks/policies' && can('breaks:manage-policy'))
      return <BreakPoliciesPage />;
    if (pathname === '/company/payroll/cycle') return <PayrollCyclePage />;
    if (pathname === '/company/payroll/my-payslips') return <MyPayslipsPage />;
    if (pathname === '/company/payroll/runs' && (isSuperAdmin || can('payroll:manage')))
      return <RunsPage onNavigate={onNavigate} />;
    if (
      pathname === '/company/payroll/salaries' &&
      (isSuperAdmin || can('payroll:manage'))
    )
      return <SalariesPage />;
    if (pathname === '/company/payroll/inputs' && (isSuperAdmin || can('payroll:manage')))
      return <PayrollInputsPage />;
    if (pathname === '/company/payroll/settings' && can('payroll:manage-config'))
      return <PayrollSettingsPage />;
    if (pathname === '/company/ta' && (isSuperAdmin || can('ta:view')))
      return <TaManagementPage />;
    if (pathname === '/company/my-ta' && (isSuperAdmin || can('ta:view-own')))
      return <MyTaPage />;
    if (pathname === '/company/settings') return <SettingsPage />;
    if (pathname === '/company/sessions') {
      return (
        <SessionsPage
          onBack={() => onNavigate('/company/dashboard')}
          onSignedOut={onLogout}
        />
      );
    }
    if (isEmployees) {
      return canViewEmployees ? (
        <EmployeesPage
          canManage={isSuperAdmin || can('users:manage')}
          isSuperAdmin={isSuperAdmin}
          canRequestRoleChange={canRequestRoleChange}
          onNavigate={onNavigate}
        />
      ) : (
        <div className="grid min-h-[60vh] place-items-center p-6 text-center">
          <div>
            <h1 className="font-display text-2xl font-bold">Access Restricted</h1>
            <p className="mt-2 text-sm text-app-muted">
              Employee directory is restricted to authorized personnel.
            </p>
          </div>
        </div>
      );
    }
    if (pathname.startsWith('/company/organization/'))
      return <OrganizationWorkspace pathname={pathname} />;
    if (pathname === '/company/geofencing') {
      return <GeofencingPage onBack={() => onNavigate('/company/dashboard')} />;
    }
    if (pathname === '/company/tasks') {
      return <TasksPage isSuperAdmin={isSuperAdmin} currentUserId={userId} />;
    }
    if (pathname === '/company/messages' && canViewChat)
      return <MessagesPage currentUserId={userId} isSuperAdmin={isSuperAdmin} canManageProjects={isSuperAdmin || can('projects:manage')} />;
    if (pathname === '/company/clients' && canViewClients) return <ClientsPage />;
    if (pathname === '/company/projects' && canViewProjects)
      return (
        <ProjectsPage
          canManageProjects={isSuperAdmin || can('projects:manage')}
          onOpenProject={(projectId) => onNavigate(`/company/projects/${projectId}`)}
        />
      );
    const projectDetail = pathname.match(/^\/company\/projects\/([^/]+)$/);
    if (projectDetail && canViewProjects)
      return (
        <ProjectDetailPage
          projectId={projectDetail[1]!}
          currentUserId={userId}
          isSuperAdmin={isSuperAdmin}
          onBack={() => onNavigate('/company/projects')}
        />
      );
    if (pathname === '/company/attendance/today')
      return <TodayPage fullName={fullName} userId={userId} />;
    if (pathname === '/company/attendance/my') return <AttendancePage userId={userId} />;
    if (
      pathname === '/company/attendance/employee-wise' &&
      (isHr || canBeyondOwn('attendance:view'))
    )
      return (
        <AttendancePageBoundary>
          <EmployeeWisePage />
        </AttendancePageBoundary>
      );
    if (
      pathname === '/company/attendance/report' &&
      (isHr || canBeyondOwn('attendance:view'))
    )
      return (
        <AttendancePageBoundary>
          <AttendanceReportPage canExport={isSuperAdmin} />
        </AttendancePageBoundary>
      );
    if (
      pathname === '/company/attendance/late' &&
      (isHr || canBeyondOwn('attendance:view'))
    )
      return (
        <AttendancePageBoundary>
          <DailyLateReportPage canExport={isSuperAdmin} />
        </AttendancePageBoundary>
      );
    if (pathname === '/company/attendance/live' && canBeyondOwn('attendance:view-live'))
      return <LiveBoardPage />;
    if (pathname === '/company/attendance/corrections' && can('attendance:correct'))
      return <CorrectionsPage />;
    if (pathname === '/company/shifts' && can('shifts:manage')) return <ShiftsPage />;
    if (pathname === '/company/holidays') return <HolidaysPage />;
    if (pathname === '/company/leave/my') {
      return <LeavePage userId={userId} organizationTimeZone={organizationTimeZone} />;
    }
    if (pathname === '/company/advance/mine' && (isSuperAdmin || can('advance:view-own')))
      return <MyAdvancesPage />;
    if (
      pathname === '/company/advance/requests' &&
      (isSuperAdmin || canBeyondOwn('advance:view'))
    )
      return <AdvanceRequestsPage />;
    // Keep old bookmarks working while the deduction schedule is now handled
    // by the payroll handoff section on Advance Requests.
    if (
      pathname === '/company/advance/deductions' &&
      (isSuperAdmin || canBeyondOwn('advance:view'))
    )
      return <AdvanceRequestsPage />;
    if (
      pathname === '/company/penalties' &&
      (isSuperAdmin || canBeyondOwn('penalty:view'))
    )
      return <PenaltiesPage />;
    if (pathname === '/company/my-penalties' && (isSuperAdmin || can('penalty:view-own')))
      return <MyPenaltiesPage />;
    if (pathname === '/company/leave/queue' && canUseLeaveQueue) {
      return (
        <LeaveQueuePage
          canAcknowledge={canAcknowledgeLeave}
          canDecide={canDecideLeave}
          canViewScopedCoverage={canViewScopedLeaveCoverage}
        />
      );
    }
    if (
      pathname === '/company/leave/balances' &&
      (canManageLeaveTypes || canViewScopedLeaveCoverage)
    ) {
      return <LeaveBalancesPage canAdjust={canManageLeaveTypes} />;
    }
    if (pathname === '/company/leave/types') {
      return canManageLeaveTypes ? (
        <LeaveTypesPage />
      ) : (
        <p role="alert" className="p-6 text-sm text-app-muted">
          You do not have access to manage leave types.
        </p>
      );
    }
    if (pathname === '/company/biometric' && can('biometric:manage'))
      return <BiometricPage />;
    if (
      canViewHandovers &&
      (pathname === '/company/sales/handovers' ||
        pathname === '/company/sales/handovers/incoming' ||
        pathname === '/company/sales/handovers/mine')
    ) {
      return (
        <HandoverPage
          view={
            pathname.endsWith('/incoming')
              ? 'incoming'
              : pathname.endsWith('/mine')
                ? 'mine'
                : 'all'
          }
          currentUserId={userId}
          onNavigate={onNavigate}
        />
      );
    }
    if (pathname === '/company/sales/territories' && canViewTerritories)
      return (
        <TerritoriesPage
          canManage={isSuperAdmin || can('territories:manage')}
          onNavigate={onNavigate}
        />
      );
    const territoryDetail = pathname.match(/^\/company\/sales\/territories\/([^/]+)$/);
    if (territoryDetail && canViewTerritories)
      return (
        <TerritoryDetailsPage
          id={territoryDetail[1]!}
          canManage={isSuperAdmin || can('territories:manage')}
          onBack={() => onNavigate('/company/sales/territories')}
        />
      );
    const callbackView =
      pathname === '/company/sales/callbacks/calendar'
        ? 'calendar'
        : pathname === '/company/sales/callbacks/board'
          ? 'board'
          : pathname === '/company/sales/callbacks/schedule'
            ? 'schedule'
            : 'list';
    if (
      pathname === '/company/sales/callbacks' ||
      pathname === '/company/sales/callbacks/calendar' ||
      pathname === '/company/sales/callbacks/board' ||
      pathname === '/company/sales/callbacks/schedule'
    ) {
      if (canViewCallbacks)
        return (
          <CallbacksPage
            view={callbackView}
            organizationTimezone={organizationTimeZone}
            onNavigate={onNavigate}
          />
        );
    }
    const callbackDetail = pathname.match(/^\/company\/sales\/callbacks\/([^/]+)$/);
    if (callbackDetail && canViewCallbacks)
      return (
        <CallbackDetailPage
          id={callbackDetail[1]!}
          currentUserId={userId}
          onBack={() => onNavigate('/company/sales/callbacks')}
          onNavigate={onNavigate}
        />
      );
    if (pathname === '/company/sales/leads/stalled' && canViewLeads)
      return (
        <StalledLeadsPage
          onBack={() => onNavigate('/company/sales/leads')}
          onNavigate={onNavigate}
        />
      );
    if (pathname === '/company/sales/leads/re-engagement' && canViewLeads)
      return (
        <ReengagementSegmentsPage onBack={() => onNavigate('/company/sales/leads')} />
      );
    if (pathname === '/company/sales/leads' && canViewLeads)
      return <LeadsPage onNavigate={onNavigate} />;
    const leadDetail = pathname.match(/^\/company\/sales\/leads\/([^/]+)$/);
    if (leadDetail && canViewLeads)
      return (
        <LeadDetailsPage
          id={leadDetail[1]!}
          currentUserId={userId}
          organizationTimezone={organizationTimeZone}
          onBack={() => onNavigate('/company/sales/leads')}
        />
      );
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
      canViewHandovers={canViewHandovers}
      canViewChat={canViewChat}
      canViewClients={canViewClients}
      canViewProjects={canViewProjects}
      canViewLiveBoard={canBeyondOwn('attendance:view-live')}
      canViewAttendanceReports={isHr || canBeyondOwn('attendance:view')}
      canReviewCorrections={can('attendance:correct')}
      canReviewBreaches={can('breaks:review-breach')}
      canManageBreakPolicies={can('breaks:manage-policy')}
      canManageShifts={can('shifts:manage')}
      canManagePayroll={isSuperAdmin || can('payroll:manage')}
      canManagePayrollConfig={isSuperAdmin || can('payroll:manage-config')}
      canViewTa={isSuperAdmin || can('ta:view') || can('ta:view-own')}
      canManageTa={isSuperAdmin || can('ta:manage')}
      canManageBiometric={can('biometric:manage')}
      canViewAdvances={
        isSuperAdmin || can('advance:view-own') || canBeyondOwn('advance:view')
      }
      canManageAdvances={isSuperAdmin || canBeyondOwn('advance:manage')}
      canViewPenalties={
        isSuperAdmin || can('penalty:view-own') || canBeyondOwn('penalty:view')
      }
      canManagePenalties={isSuperAdmin || canBeyondOwn('penalty:manage')}
      canViewExpenses={isSuperAdmin || isHr || can('payables:claim')}
      canApproveExpenses={isSuperAdmin || isHr || canBeyondOwn('payables:approve-claim')}
      isHr={Boolean(isHr)}
      hasRecruitment={hasRecruitment}
      onNavigate={onNavigate}
      onLogout={onLogout}
    >
      {renderContent()}
    </CompanyLayout>
  );
}

class AttendancePageBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  public override state: { failed: boolean } = { failed: false };

  public static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  public override componentDidCatch(error: Error, _info: ErrorInfo): void {
    console.error('Attendance page rendering failed', error);
  }

  public override render(): React.JSX.Element {
    if (this.state.failed) {
      return (
        <div
          role="alert"
          className="m-6 rounded-xl border border-app-danger/30 bg-app-danger/10 p-5 text-sm text-app-danger"
        >
          Attendance page could not be displayed. Please refresh the page. If the problem
          continues, contact your administrator.
        </div>
      );
    }
    return <>{this.props.children}</>;
  }
}
