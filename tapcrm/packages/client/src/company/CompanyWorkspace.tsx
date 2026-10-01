import { useEffect, useState } from 'react';
import {
  getCompanyEmployees,
  getCompanyIdentity,
  type CompanyIdentity,
} from './api/companyApi.js';
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
import { TasksPage } from './tasks/index.js';
import {
  getTerritories,
  TerritoriesPage,
  TerritoryDetailsPage,
  getLeads,
  getAllCallbacks,
  LeadsPage,
  LeadDetailsPage,
  StalledLeadsPage,
  ReengagementSegmentsPage,
  CallbacksPage,
  CallbackDetailPage,
  HandoverPage,
  getAllHandovers,
} from './sales/index.js';
import { RecruitmentWorkspace } from './recruitment/index.js';
import { EmployeeNotesPage, MyNotepadPage } from './notepad/index.js';
import { MyTodoPage } from './todo/index.js';

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
  const [canViewTerritories, setCanViewTerritories] = useState(false);
  const [canViewLeads, setCanViewLeads] = useState(false);
  const [canViewCallbacks, setCanViewCallbacks] = useState(false);
  const [canViewHandovers, setCanViewHandovers] = useState(false);

  useEffect(() => {
    void getCompanyIdentity()
      .then((nextIdentity) => {
        setIdentity(nextIdentity);

        if (nextIdentity.user.accountType === 'super-admin') {
          setCanViewEmployees(true);
          setEmployeesAccessChecked(true);
          setCanViewTerritories(true);
          setCanViewLeads(true);
          setCanViewCallbacks(true);
          setCanViewHandovers(true);
        } else if (nextIdentity.user.accountType === 'employee') {
          // The API is the source of truth for employee-directory access.
          // This probe only controls navigation; EmployeesPage still uses
          // the same endpoints and the server remains authoritative for
          // every action.
          void getCompanyEmployees()
            .then(() => setCanViewEmployees(true))
            .catch(() => setCanViewEmployees(false))
            .finally(() => setEmployeesAccessChecked(true));

          void getTerritories()
            .then(() => setCanViewTerritories(true))
            .catch(() => setCanViewTerritories(false));

          void getLeads()
            .then(() => setCanViewLeads(true))
            .catch(() => setCanViewLeads(false));

          void getAllCallbacks()
            .then(() => setCanViewCallbacks(true))
            .catch(() => setCanViewCallbacks(false));

          void getAllHandovers()
            .then(() => setCanViewHandovers(true))
            .catch(() => setCanViewHandovers(false));

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

  const isHr =
    isSuperAdmin ||
    (identity.user.accountType === 'employee' &&
      (identity.user.departmentCode?.toLowerCase().includes('hr') ||
        identity.user.departmentName?.toLowerCase().includes('human resources') ||
        identity.user.departmentName?.toLowerCase().includes('people') ||
        identity.user.positionCode?.toLowerCase().startsWith('hr')));

  const isOrganization =
    isSuperAdmin &&
    (pathname === '/company/organization' ||
      pathname.startsWith('/company/organization/'));

  const isRecruitment =
    (pathname === '/company/recruitment' ||
      pathname.startsWith('/company/recruitment/')) &&
    isHr;

  const isAccess = pathname === '/company/access';
  const isRoleChangeRequest = pathname === '/company/role-change-request';
  const isAudit = pathname === '/company/audit';
  const isEmployees = pathname === '/company/employees';
  const isEmployeeNotes = pathname === '/company/employee-notes';
  const isTodo =
    pathname === '/company/todo' || pathname === '/company/my-todo';
  const isNotepad =
    pathname === '/company/my-notepad' || pathname === '/company/notepad';

  const isTerritories = pathname === '/company/sales/territories';
  const isLeads = pathname === '/company/sales/leads';
  const isStalledLeads = pathname === '/company/sales/leads/stalled';
  const isReengagement = pathname === '/company/sales/leads/re-engagement';
  const isCallbacks = pathname === '/company/sales/callbacks';
  const isCallbackCalendar = pathname === '/company/sales/callbacks/calendar';
  const isCallbackBoard = pathname === '/company/sales/callbacks/board';
  const isCallbackSchedule = pathname === '/company/sales/callbacks/schedule';
  const isHandovers = pathname === '/company/sales/handovers';
  const isIncomingHandovers = pathname === '/company/sales/handovers/incoming';
  const isMyHandovers = pathname === '/company/sales/handovers/mine';
  const callbackDetailMatch = isCallbacks || isCallbackCalendar || isCallbackBoard || isCallbackSchedule ? null : pathname.match(/^\/company\/sales\/callbacks\/([^/]+)$/);

  const territoryDetailMatch = pathname.match(
    /^\/company\/sales\/territories\/([^/]+)$/,
  );

  const leadDetailMatch =
    isStalledLeads || isReengagement
      ? null
      : pathname.match(/^\/company\/sales\/leads\/([^/]+)$/);

  const title = isTodo
    ? 'My Todo'
    : isNotepad
      ? 'My Notepad'
      : isEmployeeNotes
        ? 'Employee Notes'
        : isOrganization
          ? 'Organization'
          : isRecruitment
            ? 'Recruitment'
            : isEmployees
              ? 'Employees'
              : pathname === '/company/sessions'
                ? 'Sessions & Devices'
                : isAccess
                  ? 'Access Explorer'
                  : isRoleChangeRequest
                    ? 'Request Role Change'
                    : isAudit
                      ? 'Audit Log'
                      : pathname === '/company/geofencing'
                        ? 'Geofencing'
                        : pathname === '/company/tasks'
                          ? 'Tasks'
                          : isTerritories || territoryDetailMatch
                            ? 'Territories'
                            : isCallbacks ||
                                isCallbackCalendar ||
                                isCallbackBoard ||
                                isCallbackSchedule ||
                                callbackDetailMatch
                              ? 'Callbacks'
                              : isHandovers || isIncomingHandovers || isMyHandovers
                                ? 'Handovers'
                                : isLeads ||
                                    isStalledLeads ||
                                    isReengagement ||
                                    leadDetailMatch
                                  ? 'Leads'
                                  : 'Dashboard';

  const content = isTodo ? (
    <MyTodoPage />
  ) : isNotepad ? (
    <MyNotepadPage />
  ) : isEmployeeNotes ? (
    isSuperAdmin ? (
      <EmployeeNotesPage />
    ) : (
      <div className="grid min-h-[60vh] place-items-center p-6 text-center">
        <div>
          <h1 className="font-display text-2xl font-bold">
            Access Restricted
          </h1>

          <p className="mt-2 text-sm text-app-muted">
            Employee notes monitoring is restricted to Super Admin.
          </p>
        </div>
      </div>
    )
  ) : isOrganization ? (
    <OrganizationWorkspace pathname={pathname} />
  ) : isRecruitment ? (
    <RecruitmentWorkspace pathname={pathname} onNavigate={onNavigate} />
  ) : isAccess && isSuperAdmin ? (
    <AccessExplorerPage />
  ) : isRoleChangeRequest && !isSuperAdmin ? (
    <RoleChangeRequestPage />
  ) : isAudit && (isSuperAdmin || canViewAudit) ? (
    <AuditLogPage canManageHolds={isSuperAdmin} canExport={isSuperAdmin} />
  ) : pathname === '/company/sessions' ? (
    <SessionsPage
      onBack={() => onNavigate('/company/dashboard')}
      onSignedOut={onLogout}
    />
  ) : isEmployees ? (
    isSuperAdmin || isHr || (employeesAccessChecked && canViewEmployees) ? (
      <EmployeesPage />
    ) : (
      <div className="grid min-h-[60vh] place-items-center p-6 text-center">
        <div>
          <h1 className="font-display text-2xl font-bold">Access Restricted</h1>

          <p className="mt-2 text-sm text-app-muted">
            Employee directory is restricted to authorized personnel.
          </p>
        </div>
      </div>
    )
  ) : pathname === '/company/tasks' ? (
    <TasksPage isSuperAdmin={isSuperAdmin} currentUserId={identity.user.id} />
  ) : isTerritories && (isSuperAdmin || canViewTerritories) ? (
    <TerritoriesPage
      canManage={isSuperAdmin || canViewTerritories}
      onNavigate={onNavigate}
    />
  ) : territoryDetailMatch && (isSuperAdmin || canViewTerritories) ? (
    <TerritoryDetailsPage
      id={territoryDetailMatch[1]!}
      canManage={isSuperAdmin}
      onBack={() => onNavigate('/company/sales/territories')}
    />
  ) : (isCallbacks || isCallbackCalendar || isCallbackBoard || isCallbackSchedule || callbackDetailMatch) &&
    (isSuperAdmin || canViewCallbacks) ? (
    callbackDetailMatch ? (
      <CallbackDetailPage id={callbackDetailMatch[1]!} currentUserId={identity.user.id} onBack={() => onNavigate('/company/sales/callbacks')} onNavigate={onNavigate} />
    ) : (
      <CallbacksPage view={isCallbackCalendar ? 'calendar' : isCallbackBoard ? 'board' : isCallbackSchedule ? 'schedule' : 'list'} organizationTimezone={identity.organization?.timezone ?? 'Asia/Kolkata'} onNavigate={onNavigate} />
    )
  ) : (isHandovers || isIncomingHandovers || isMyHandovers) && (isSuperAdmin || canViewHandovers) ? (
    <HandoverPage view={isIncomingHandovers ? 'incoming' : isMyHandovers ? 'mine' : 'all'} currentUserId={identity.user.id} onNavigate={onNavigate} />
  ) : (isLeads || isStalledLeads || isReengagement || leadDetailMatch) &&
    (isSuperAdmin || canViewLeads) ? (
    leadDetailMatch ? (
      <LeadDetailsPage
        id={leadDetailMatch[1]!}
        currentUserId={identity.user.id}
        organizationTimezone={identity.organization?.timezone ?? 'Asia/Kolkata'}
        onBack={() => onNavigate('/company/sales/leads')}
      />
    ) : isStalledLeads ? (
      <StalledLeadsPage
        onBack={() => onNavigate('/company/sales/leads')}
        onNavigate={onNavigate}
      />
    ) : isReengagement ? (
      <ReengagementSegmentsPage onBack={() => onNavigate('/company/sales/leads')} />
    ) : (
      <LeadsPage onNavigate={onNavigate} />
    )
  ) : !isSuperAdmin ? (
    <div className="grid min-h-[60vh] place-items-center p-6 text-center">
      <div>
        <h1 className="font-display text-2xl font-bold">
          Employee workspace is coming soon
        </h1>

        <p className="mt-2 text-sm text-app-muted">
          Your account can still review its active Sessions &amp; Devices.
        </p>
      </div>
    </div>
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
      canViewEmployees={canViewEmployees}
      canViewTerritories={canViewTerritories}
      canViewLeads={canViewLeads}
      canViewHandovers={canViewHandovers}
      title={title}
      onNavigate={onNavigate}
      onLogout={onLogout}
    >
      {content}
    </CompanyLayout>
  );
}
