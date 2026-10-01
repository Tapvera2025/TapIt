import { useState } from 'react';
import { BrandLogo } from '../../ui/BrandLogo.js';
import { Icon } from '../../ui/Icon.js';
import { ThemeToggle } from '../../theme/ThemeToggle.js';
import { SidebarPet, useAiPet } from './AiPet.js';
import { myNotepadNavItem, type CompanyNavGroup } from './navigation.js';

export function CompanySidebar({
  pathname,
  identity,
  organizationName,
  accountType,
  canRequestRoleChange = false,
  canViewAudit = false,
  canManageLeaveTypes = false,
  canViewLeaveBalances = false,
  canUseLeaveQueue = false,
  canViewEmployees = false,
  canViewTerritories = false,
  canViewLeads = false,
  canViewCallbacks = false,
  canViewHandovers = false,
  canViewLiveBoard = false,
  canReviewCorrections = false,
  canReviewBreaches = false,
  canManageBreakPolicies = false,
  canManageShifts = false,
  canManagePayroll = false,
  canManagePayrollConfig = false,
  canManageBiometric = false,
  isHr = false,
  hasRecruitment = false,
  onNavigate,
  onLogout,
  open,
  onClose,
}: {
  pathname: string;
  identity: {
    fullName: string;
    email: string;
    accountType?: string;
    departmentCode?: string | null;
    departmentName?: string | null;
    positionCode?: string | null;
  };
  organizationName: string | null;
  accountType: string;
  canRequestRoleChange?: boolean;
  canViewAudit?: boolean;
  canManageLeaveTypes?: boolean;
  canViewLeaveBalances?: boolean;
  canUseLeaveQueue?: boolean;
  canViewEmployees?: boolean;
  canViewTerritories?: boolean;
  canViewLeads?: boolean;
  canViewCallbacks?: boolean;
  canViewHandovers?: boolean;
  canViewLiveBoard?: boolean;
  canReviewCorrections?: boolean;
  canReviewBreaches?: boolean;
  canManageBreakPolicies?: boolean;
  canManageShifts?: boolean;
  canManagePayroll?: boolean;
  canManagePayrollConfig?: boolean;
  canManageBiometric?: boolean;
  isHr?: boolean;
  hasRecruitment?: boolean;
  onNavigate: (path: string) => void;
  onLogout: () => void;
  open: boolean;
  onClose: () => void;
}): React.JSX.Element {
  const [organizationOpen, setOrganizationOpen] = useState(pathname.startsWith('/company/organization'));
  const [recruitmentOpen, setRecruitmentOpen] = useState(pathname.startsWith('/company/recruitment'));
  const isSuperAdmin = accountType === 'super-admin';
  const { activePet } = useAiPet();

  const navigation: CompanyNavGroup[] = [
    {
      label: 'Overview',
      items: [
        { label: 'Dashboard', path: '/company/dashboard', icon: 'grid' },
        { label: 'Tasks', path: '/company/tasks', icon: 'check' },
        myNotepadNavItem,
      ],
    },
    ...(isSuperAdmin
      ? [{
          label: 'Organization',
          items: [
            { label: 'Overview', path: '/company/organization', icon: 'grid' },
            { label: 'Departments', path: '/company/organization/departments', icon: 'building' },
            { label: 'Teams', path: '/company/organization/teams', icon: 'users' },
            { label: 'Positions', path: '/company/organization/positions', icon: 'briefcase' },
            { label: 'Designations', path: '/company/organization/designations', icon: 'briefcase' },
            { label: 'Reporting', path: '/company/organization/reporting', icon: 'users' },
            { label: 'Org Chart', path: '/company/organization/org-chart', icon: 'hierarchy' },
          ],
        }]
      : []),
    ...(isHr || canViewEmployees || isSuperAdmin
      ? [{
          label: 'People',
          items: [
            { label: 'Employees', path: '/company/employees', icon: 'users' },
            ...(isSuperAdmin ? [{ label: 'Employee Notes', path: '/company/employee-notes', icon: 'notepad' }] : []),
            ...(isHr && hasRecruitment
              ? [{
                  label: 'Recruitment',
                  path: '/company/recruitment',
                  icon: 'briefcase',
                  children: [
                    { label: 'Overview', path: '/company/recruitment' },
                    { label: 'Requisitions', path: '/company/recruitment/requisitions' },
                    { label: 'Resume Inbox', path: '/company/recruitment/resumes' },
                    { label: 'Candidates', path: '/company/recruitment/candidates' },
                    { label: 'Interviews', path: '/company/recruitment/interviews' },
                    { label: 'Offers', path: '/company/recruitment/offers' },
                    { label: 'Joining', path: '/company/recruitment/joining' },
                  ],
                }]
              : []),
          ],
        }]
      : []),
    ...((canViewTerritories || canViewLeads || canViewCallbacks || canViewHandovers) ? [{
      label: 'Sales',
      items: [
        ...(canViewTerritories ? [{ label: 'Territories', path: '/company/sales/territories', icon: 'map' }] : []),
        ...(canViewLeads ? [{ label: 'Leads', path: '/company/sales/leads', icon: 'users' }] : []),
        ...(canViewCallbacks ? [{ label: 'Callbacks', path: '/company/sales/callbacks', icon: 'calendar' }] : []),
        ...(canViewHandovers ? [{ label: 'Handovers', path: '/company/sales/handovers', icon: 'share' }] : []),
      ],
    }] : []),
    {
      label: 'Attendance',
      items: [
        { label: 'Today', path: '/company/attendance/today', icon: 'clock' },
        { label: 'My Attendance', path: '/company/attendance/my', icon: 'calendar' },
        ...(canViewLiveBoard ? [{ label: 'Workforce Board', path: '/company/attendance/live', icon: 'users' }] : []),
        ...(canReviewCorrections ? [{ label: 'Corrections', path: '/company/attendance/corrections', icon: 'edit' }] : []),
        ...(canReviewBreaches ? [{ label: 'Break Queue', path: '/company/breaks/queue', icon: 'alert-circle' }] : []),
        ...(canManageBreakPolicies ? [{ label: 'Break Policies', path: '/company/breaks/policies', icon: 'settings' }] : []),
        ...(canManageBiometric ? [{ label: 'Biometric', path: '/company/biometric', icon: 'cpu' }] : []),
      ],
    },
    {
      label: 'Shifts & Leave',
      items: [
        { label: 'My Leave', path: '/company/leave/my', icon: 'sun' },
        ...(canUseLeaveQueue ? [{ label: 'Leave Queue', path: '/company/leave/queue', icon: 'inbox' }] : []),
        ...(canViewLeaveBalances ? [{ label: 'Leave Balances', path: '/company/leave/balances', icon: 'chart' }] : []),
        ...(canManageLeaveTypes ? [{ label: 'Leave Types', path: '/company/leave/types', icon: 'settings' }] : []),
        { label: 'Holidays', path: '/company/holidays', icon: 'flag' },
        ...(canManageShifts ? [{ label: 'Shifts', path: '/company/shifts', icon: 'layers' }] : []),
      ],
    },
    {
      label: 'Payroll',
      items: [
        { label: 'My Payslips', path: '/company/payroll/my-payslips', icon: 'file-text' },
        ...(canManagePayroll
          ? [
              { label: 'Payroll Cycle', path: '/company/payroll/cycle', icon: 'calendar' },
              { label: 'Payroll Runs', path: '/company/payroll/runs', icon: 'dollar-sign' },
              { label: 'Salary Structures', path: '/company/payroll/salaries', icon: 'briefcase' },
              { label: 'Bonuses & Deductions', path: '/company/payroll/inputs', icon: 'chart' },
            ]
          : []),
        ...(canManagePayrollConfig
          ? [{ label: 'Payroll Settings', path: '/company/payroll/settings', icon: 'settings' }]
          : []),
      ],
    },
    {
      label: 'Identity & Access',
      items: [
        { label: 'Sessions & Devices', path: '/company/sessions', icon: 'monitor' },
        ...(isSuperAdmin ? [{ label: 'Access Explorer', path: '/company/access', icon: 'shield' }] : []),
        ...(isSuperAdmin || canViewAudit ? [{ label: 'Audit Log', path: '/company/audit', icon: 'clipboard' }] : []),
        ...(isSuperAdmin ? [{ label: 'Geofencing', path: '/company/geofencing', icon: 'pin' }] : []),
        ...(accountType === 'employee' && canRequestRoleChange
          ? [{ label: 'Request Role Change', path: '/company/role-change-request', icon: 'briefcase' }]
          : []),
      ],
    },
  ];

  return (
    <aside
      className={`workspace-sidebar fixed inset-y-0 left-0 z-40 flex h-dvh min-h-0 w-64 flex-col border-r border-app-border bg-app-surface px-4 py-5 transition-transform md:static md:translate-x-0 ${open ? 'translate-x-0' : '-translate-x-full'}`}
    >
      <div className="flex shrink-0 items-center justify-between px-3">
        <div>
          <BrandLogo className="w-[176px]" />
          <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.16em] text-app-muted">
            Company Workspace
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-2 text-app-muted hover:bg-app-background md:hidden"
          aria-label="Close navigation"
        >
          ×
        </button>
      </div>
      <nav className="mt-8 min-h-0 flex-1 space-y-7 overflow-y-auto" aria-label="Company navigation">
        {navigation.map((group) => {
          const isOrganization = group.label === 'Organization';
          const activeChild = group.items.some(
            (item) => pathname === item.path || pathname.startsWith(`${item.path}/`),
          );
          return (
            <div key={group.label}>
              {isOrganization ? (
                <button
                  type="button"
                  onClick={() => setOrganizationOpen((openState) => !openState)}
                  aria-expanded={organizationOpen}
                  className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-[10px] font-bold uppercase tracking-[0.16em] ${activeChild ? 'bg-app-accent/15 text-app-accent' : 'text-app-muted hover:bg-app-background hover:text-app-foreground'}`}
                >
                  <span>Organization</span>
                  <span aria-hidden="true">{organizationOpen ? '−' : '+'}</span>
                </button>
              ) : (
                <p className="px-3 text-[10px] font-bold uppercase tracking-[0.16em] text-app-muted">{group.label}</p>
              )}
              {(!isOrganization || organizationOpen) && (
                <div className="mt-2 space-y-1">
                  {group.items.map((item) => {
                    const isActive = pathname === item.path || (item.path !== '/company/organization' && pathname.startsWith(`${item.path}/`));
                    const showChildren = Boolean(item.children && (recruitmentOpen || pathname.startsWith(item.path)));
                    return (
                      <div key={item.path}>
                        <button
                          aria-current={isActive ? 'page' : undefined}
                          type="button"
                          onClick={() => {
                            if (item.label === 'Recruitment') setRecruitmentOpen((prev) => !prev);
                            onNavigate(item.path);
                            onClose();
                          }}
                          className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-sm font-semibold transition ${isActive ? 'bg-app-accent/15 text-app-accent' : 'text-app-muted hover:bg-app-background hover:text-app-foreground'}`}
                        >
                          <span className="flex items-center gap-3"><Icon name={item.icon} /><span>{item.label}</span></span>
                          {item.children && <span aria-hidden="true" className="text-xs text-app-muted">{showChildren ? '▾' : '▸'}</span>}
                        </button>
                        {showChildren && (
                          <div className="ml-7 mt-1 space-y-1 border-l border-app-border pl-2">
                            {item.children!.map((sub) => {
                              const active = sub.path === '/company/recruitment'
                                ? pathname === sub.path
                                : pathname === sub.path || pathname.startsWith(`${sub.path}/`);
                              return (
                                <button
                                  key={sub.path}
                                  type="button"
                                  aria-current={active ? 'page' : undefined}
                                  onClick={() => { onNavigate(sub.path); onClose(); }}
                                  className={`w-full rounded-lg px-3 py-2 text-left text-xs font-semibold ${active ? 'text-app-accent' : 'text-app-muted hover:bg-app-background hover:text-app-foreground'}`}
                                >
                                  {sub.label}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
        <div className="sidebar-decoration">
          <p className="text-sm font-medium leading-5">Work smarter.<br />Grow together.</p>
          <div className="mt-3 h-1 w-10 rounded-full bg-app-accent" />
        </div>
      </nav>
      {activePet && <SidebarPet pet={activePet} />}
      <div className="shrink-0 border-t border-app-border pt-4">
        <div className="mb-4 px-3"><ThemeToggle /></div>
        <p className="truncate px-3 text-sm font-bold">{identity.fullName}</p>
        <p className="mt-1 truncate px-3 text-xs text-app-muted">{identity.email}</p>
        <p className="mt-1 truncate px-3 text-[11px] font-semibold text-app-accent" title={organizationName ?? undefined}>
          {organizationName ?? 'Organization unavailable'}
        </p>
        <button
          type="button"
          onClick={onLogout}
          className="mt-3 w-full rounded-xl px-3 py-2.5 text-left text-sm font-semibold text-app-danger hover:bg-[#d86b6b]/10"
        >
          Log out
        </button>
      </div>
    </aside>
  );
}
