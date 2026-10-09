import { useState, useEffect, useRef } from 'react';
import Lenis from 'lenis';
import { BrandLogo } from '../../ui/BrandLogo.js';
import { Icon } from '../../ui/Icon.js';
import { useTheme, type AccentColor } from '../../theme/ThemeContext.js';
import { SidebarPet, useAiPet } from './AiPet.js';
import { myNotepadNavItem, myTodoNavItem, type CompanyNavGroup } from './navigation.js';

function ThemePromoIllustration({ accent }: { accent: AccentColor }): React.JSX.Element {
  const common = {
    className: 'sidebar-decoration-symbol size-14',
    viewBox: '0 0 64 64',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2.5,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };

  if (accent === 'green') {
    return (
      <svg {...common}>
        <path d="M32 52V26" />
        <path d="M32 35c-9 0-15-5-16-14 9 0 15 5 16 14Z" fill="currentColor" fillOpacity=".18" />
        <path d="M32 29c1-9 7-14 16-14-1 9-7 14-16 14Z" fill="currentColor" fillOpacity=".28" />
        <path d="M25 52h14" />
      </svg>
    );
  }
  if (accent === 'blue') {
    return (
      <svg {...common}>
        <path d="M32 10c-5 8-12 14-12 23a12 12 0 0 0 24 0c0-9-7-15-12-23Z" fill="currentColor" fillOpacity=".18" />
        <path d="M14 47c5-4 10-4 15 0s10 4 15 0 7-4 10-2" />
      </svg>
    );
  }
  if (accent === 'orange') {
    return (
      <svg {...common}>
        <path d="M34 53c-10 0-16-6-16-15 0-7 5-11 10-17 3-4 4-8 4-12 8 6 13 13 13 22 0 4-1 7-3 9 1-7-2-12-6-15 1 8-9 11-9 18 0 6 3 9 7 10Z" fill="currentColor" fillOpacity=".22" />
        <path d="M27 52c-3-2-5-5-5-9 0-4 2-7 5-10-1 7 2 9 5 12 2 2 2 5 1 7" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="m32 9 10 16-10 30-10-30L32 9Z" fill="currentColor" fillOpacity=".2" />
      <path d="m32 9 10 16-10 30-10-30L32 9Z" />
      <path d="m22 25 10 5 10-5M32 30v25" />
      <path d="M49 10v9M44.5 14.5h9" strokeWidth="2" />
    </svg>
  );
}

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
  canViewChat = false,
  canViewClients = false,
  canViewProjects = false,
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
  canViewChat?: boolean;
  canViewClients?: boolean;
  canViewProjects?: boolean;
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
  const prevPathnameRef = useRef(pathname);
  const navigationRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const navigation = navigationRef.current;
    if (!navigation) return;

    const lenis = new Lenis({
      wrapper: navigation,
      content: navigation,
      duration: 0.9,
      smoothWheel: true,
      syncTouch: true,
      autoRaf: true,
    });

    return () => lenis.destroy();
  }, []);

  useEffect(() => {
    const wasRecruitment = prevPathnameRef.current.startsWith('/company/recruitment');
    const isRecruitment = pathname.startsWith('/company/recruitment');
    if (!wasRecruitment && isRecruitment) {
      setRecruitmentOpen(true);
    }
    prevPathnameRef.current = pathname;
  }, [pathname]);

  const isSuperAdmin = accountType === 'super-admin';
  const { activePet } = useAiPet();
  const { accent } = useTheme();

  const navigation: CompanyNavGroup[] = [
    {
      label: 'Overview',
      items: [
        { label: 'Dashboard', path: '/company/dashboard', icon: 'grid' },
        { label: 'Tasks', path: '/company/tasks', icon: 'check' },
        ...(canViewChat ? [{ label: 'Messages', path: '/company/messages', icon: 'message' }] : []),
        myTodoNavItem,
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
    ...((canViewClients || canViewProjects) ? [{
      label: 'Delivery',
      items: [
        ...(canViewClients ? [{ label: 'Clients', path: '/company/clients', icon: 'briefcase' }] : []),
        ...(canViewProjects ? [{ label: 'Projects', path: '/company/projects', icon: 'grid' }] : []),
      ],
    }] : []),
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
          ? [{ label: 'Payroll Settings', path: '/company/payroll/settings', icon: 'wallet' }]
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
    {
      label: 'Preferences',
      items: [
        { label: 'Settings', path: '/company/settings', icon: 'settings' },
      ],
    },
  ];

  return (
    <aside
      className={`workspace-sidebar fixed inset-y-0 left-0 z-40 flex h-dvh min-h-0 w-64 flex-col border-r border-sidebar-border bg-sidebar-bg px-4 py-5 transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-transform md:static md:translate-x-0 ${open ? 'translate-x-0' : '-translate-x-full'}`}
    >
      <div className="flex shrink-0 items-center justify-between px-3">
        <div>
          <BrandLogo className="w-[176px]" />
          <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.16em] text-sidebar-muted">
            Company Workspace
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-2 text-sidebar-muted hover:bg-sidebar-hover-bg hover:text-sidebar-foreground md:hidden"
          aria-label="Close navigation"
        >
          ×
        </button>
      </div>
      <nav ref={navigationRef} className="mt-8 min-h-0 flex-1 space-y-7 overflow-y-auto" aria-label="Company navigation">
        {navigation.map((group) => {
          const isOrganization = group.label === 'Organization';
          const activeChild = group.items.some(
            (item) => pathname === item.path || pathname.startsWith(`${item.path}/`),
          );
          return (
            <div key={group.label} className={group.label === 'Preferences' ? 'sidebar-preferences-group' : undefined}>
              {isOrganization ? (
                <button
                  type="button"
                  onClick={() => setOrganizationOpen((openState) => !openState)}
                  aria-expanded={organizationOpen}
                  className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.14em] ${activeChild ? 'bg-sidebar-hover-bg text-sidebar-foreground' : 'text-sidebar-section-muted hover:bg-sidebar-hover-bg hover:text-sidebar-foreground'}`}
                >
                  <span>Organization</span>
                  <span aria-hidden="true">{organizationOpen ? '−' : '+'}</span>
                </button>
              ) : (
                <p className="px-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-sidebar-section-muted">{group.label}</p>
              )}
              {(!isOrganization || organizationOpen) && (
                <div className="mt-2 space-y-1">
                  {group.items.map((item) => {
                    const isRecruitmentItem = item.label === 'Recruitment';
                    const isActive = pathname === item.path || (item.path !== '/company/organization' && pathname.startsWith(`${item.path}/`));
                    const showChildren = Boolean(item.children && (isRecruitmentItem ? recruitmentOpen : true));
                    return (
                      <div key={item.path}>
                        <button
                          aria-current={isActive ? 'page' : undefined}
                          type="button"
                          aria-expanded={item.children ? showChildren : undefined}
                          onClick={() => {
                            if (isRecruitmentItem) {
                              if (!pathname.startsWith(item.path)) {
                                setRecruitmentOpen(true);
                                onNavigate(item.path);
                                onClose();
                              } else {
                                setRecruitmentOpen((prev) => !prev);
                              }
                            } else {
                              onNavigate(item.path);
                              onClose();
                            }
                          }}
                          className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-sm font-medium transition ${isActive ? 'bg-sidebar-active-bg text-sidebar-active-fg shadow-xs' : 'text-sidebar-nav-muted hover:bg-sidebar-hover-bg hover:text-sidebar-foreground'}`}
                        >
                          <span className="flex items-center gap-3"><Icon name={item.icon} /><span>{item.label}</span></span>
                          {item.children && <span aria-hidden="true" className="text-xs text-sidebar-muted">{showChildren ? '▾' : '▸'}</span>}
                        </button>
                        {showChildren && (
                          <div className="ml-7 mt-1 space-y-1 border-l border-sidebar-border pl-2">
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
                                  className={`w-full rounded-lg px-3 py-2 text-left text-xs font-medium ${active ? 'text-sidebar-foreground font-semibold' : 'text-sidebar-nav-muted hover:bg-sidebar-hover-bg hover:text-sidebar-foreground'}`}
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
          <div className="relative z-10 max-w-[76%]">
            <p className="text-sm font-medium leading-5">Work smarter.<br />Grow together.</p>
            <div className="mt-3 h-1 w-10 rounded-full bg-app-accent" />
          </div>
          <ThemePromoIllustration accent={accent} />
        </div>
      </nav>
      {activePet && <SidebarPet pet={activePet} />}
      <div className="shrink-0 border-t border-sidebar-border pt-4">
        <div className="sidebar-profile-card">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="sidebar-profile-avatar flex size-10 items-center justify-center rounded-full text-xs font-bold shrink-0">
              {identity.fullName
                ? identity.fullName
                    .trim()
                    .split(/\s+/)
                    .map((p) => p[0])
                    .filter(Boolean)
                    .slice(0, 2)
                    .join('')
                    .toUpperCase()
                : 'U'}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-sidebar-foreground">{identity.fullName}</p>
              <p className="truncate text-[11px] leading-4 text-sidebar-muted">{identity.email}</p>
              <span
                className="mt-1 inline-flex rounded-md bg-amber-400/12 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-amber-600 dark:text-amber-300"
                title={organizationName ?? undefined}
              >
                {organizationName ? organizationName.slice(0, 3).toUpperCase() : 'ABP'}
              </span>
            </div>
          </div>
        </div>
        <div className="mt-3 border-t border-sidebar-border/70 pt-3">
          <button
            type="button"
            onClick={onLogout}
            className="sidebar-logout flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-xs font-semibold text-rose-600 transition-colors cursor-pointer dark:text-rose-300"
          >
            <Icon name="logout" className="size-3.5" />
            <span>Log out</span>
          </button>
        </div>
      </div>
    </aside>
  );
}
