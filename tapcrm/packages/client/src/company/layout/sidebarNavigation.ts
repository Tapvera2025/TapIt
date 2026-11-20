import {
  isDestinationModuleEnabled,
  myNotepadNavItem,
  myTodoNavItem,
  type CompanyNavGroup,
} from './navigation.js';

export type SidebarVariant = 'company' | 'client' | 'platform';

/**
 * Everything that decides which menu entries a user sees. The sidebar is a pure
 * view over this: add a capability here and in the builder, never in the UI.
 */
export interface SidebarNavigationInput {
  variant?: SidebarVariant;
  accountType: string;
  /** Modules enabled for the company; omitted means every module is offered. */
  enabledModules?: readonly string[] | undefined;
  canRequestRoleChange?: boolean;
  canViewAudit?: boolean;
  canManageLeaveTypes?: boolean;
  canViewLeaveBalances?: boolean;
  canUseLeaveQueue?: boolean;
  canViewEmployees?: boolean;
  canViewTerritories?: boolean;
  canViewLeads?: boolean;
  canViewCallbacks?: boolean;
  canViewCalls?: boolean;
  canTriageSales?: boolean;
  canViewImports?: boolean;
  canTrackAssignedCalls?: boolean;
  canManageCalls?: boolean;
  canViewHandovers?: boolean;
  canViewDeals?: boolean;
  canRecordWin?: boolean;
  canDecideApprovals?: boolean;
  canForecast?: boolean;
  canViewChat?: boolean;
  canViewClients?: boolean;
  canViewSocial?: boolean;
  canViewMeetings?: boolean;
  canViewSeo?: boolean;
  canViewProjects?: boolean;
  canViewLiveBoard?: boolean;
  canViewAttendanceReports?: boolean;
  canReviewCorrections?: boolean;
  canReviewBreaches?: boolean;
  canManageBreakPolicies?: boolean;
  canManageShifts?: boolean;
  canManagePayroll?: boolean;
  canManagePayrollConfig?: boolean;
  canViewAccounting?: boolean;
  canViewTa?: boolean;
  canManageTa?: boolean;
  canManageBiometric?: boolean;
  canViewAdvances?: boolean;
  canManageAdvances?: boolean;
  canViewPenalties?: boolean;
  canManagePenalties?: boolean;
  canViewExpenses?: boolean;
  canApproveExpenses?: boolean;
  isHr?: boolean;
  canViewRecruitment?: boolean;
  canViewAccessExplorer?: boolean;
  hasRecruitment?: boolean;
  hasInterviews?: boolean;
}

/** The menu groups one user sees. Groups with no entries are already removed. */
export function buildSidebarNavigation(input: SidebarNavigationInput): CompanyNavGroup[] {
  const groups = buildUnfilteredNavigation(input);
  // Client and platform menus are fixed and not module-gated.
  if ((input.variant ?? 'company') !== 'company') return groups;
  return withoutUnavailableEntries(groups, input.enabledModules);
}

/**
 * Drops every entry (and sub-entry) whose module is switched off, any entry whose
 * sub-entries all vanished, and any group left empty. One rule for the whole
 * menu, so a new entry cannot forget its module check.
 */
function withoutUnavailableEntries(
  groups: readonly CompanyNavGroup[],
  enabledModules: readonly string[] | undefined,
): CompanyNavGroup[] {
  return groups
    .map((group) => ({
      ...group,
      items: group.items.flatMap((item) => {
        if (!isDestinationModuleEnabled(item.path, enabledModules)) return [];
        if (!item.children) return [item];
        const children = item.children.filter((child) =>
          isDestinationModuleEnabled(child.path, enabledModules),
        );
        return children.length > 0 ? [{ ...item, children }] : [];
      }),
    }))
    .filter((group) => group.items.length > 0);
}

function buildUnfilteredNavigation(input: SidebarNavigationInput): CompanyNavGroup[] {
  const {
    variant = 'company',
    accountType,
    enabledModules,
    canRequestRoleChange = false,
    canViewAudit = false,
    canManageLeaveTypes = false,
    canViewLeaveBalances = false,
    canUseLeaveQueue = false,
    canViewEmployees = false,
    canViewTerritories = false,
    canViewLeads = false,
    canViewCallbacks = false,
    canViewCalls = false,
    canTriageSales = false,
    canViewImports = false,
    canTrackAssignedCalls = false,
    canManageCalls = false,
    canViewHandovers = false,
    canViewDeals = false,
    canRecordWin = false,
    canDecideApprovals = false,
    canForecast = false,
    canViewChat = false,
    canViewClients = false,
    canViewSocial = false,
    canViewMeetings = false,
    canViewSeo = false,
    canViewProjects = false,
    canViewLiveBoard = false,
    canViewAttendanceReports = false,
    canReviewCorrections = false,
    canReviewBreaches = false,
    canManageBreakPolicies = false,
    canManageShifts = false,
    canManagePayroll = false,
    canManagePayrollConfig = false,
    canViewAccounting = false,
    canViewTa = false,
    canManageTa = false,
    canManageBiometric = false,
    canViewAdvances = false,
    canManageAdvances = false,
    canViewPenalties = false,
    canManagePenalties = false,
    canViewExpenses = false,
    canApproveExpenses = false,
    isHr = false,
    canViewRecruitment = false,
    canViewAccessExplorer = false,
    hasRecruitment = false,
    hasInterviews = false,
  } = input;
  const isSuperAdmin = accountType === 'super-admin';
  // Module-backed items disappear when the company has the module switched off.
  const moduleOn = (key: string): boolean =>
    !enabledModules || enabledModules.includes(key);

  const navigation: CompanyNavGroup[] = [
    {
      label: 'Overview',
      items: [
        { label: 'Dashboard', path: '/company/dashboard', icon: 'grid' },
        { label: 'Tasks', path: '/company/tasks', icon: 'check' },
        ...(hasInterviews
          ? [{ label: 'My Interviews', path: '/company/my-interviews', icon: 'calendar' }]
          : []),
        ...(canViewChat
          ? [{ label: 'Messages', path: '/company/messages', icon: 'message' }]
          : []),
        myTodoNavItem,
        myNotepadNavItem,
      ],
    },
    ...(isSuperAdmin || canViewEmployees
      ? [
          {
            label: 'Organization',
            items: [
              ...(canViewEmployees || isSuperAdmin
                ? [{ label: 'Employees', path: '/company/employees', icon: 'users' }]
                : []),
              ...(isSuperAdmin
                ? [
                    { label: 'Overview', path: '/company/organization', icon: 'grid' },
                    {
                      label: 'Departments',
                      path: '/company/organization/departments',
                      icon: 'building',
                    },
                    {
                      label: 'Teams',
                      path: '/company/organization/teams',
                      icon: 'users',
                    },
                    {
                      label: 'Positions',
                      path: '/company/organization/positions',
                      icon: 'briefcase',
                    },
                    {
                      label: 'Designations',
                      path: '/company/organization/designations',
                      icon: 'briefcase',
                    },
                    {
                      label: 'Reporting',
                      path: '/company/organization/reporting',
                      icon: 'users',
                    },
                    {
                      label: 'Org Chart',
                      path: '/company/organization/org-chart',
                      icon: 'hierarchy',
                    },
                  ]
                : []),
            ],
          },
        ]
      : []),
    ...(isSuperAdmin
      ? [
          {
            label: 'Employee Activities',
            items: [
              {
                label: 'Employee Notes',
                path: '/company/employee-notes',
                icon: 'notepad',
              },
            ],
          },
        ]
      : []),
    ...((isHr || canViewRecruitment) && hasRecruitment
      ? [
          {
            label: 'Recruitment',
            items: [
              { label: 'Overview', path: '/company/recruitment', icon: 'grid' },
              {
                label: 'Requisitions',
                path: '/company/recruitment/requisitions',
                icon: 'clipboard-list',
              },
              {
                label: 'Resume Inbox',
                path: '/company/recruitment/resumes',
                icon: 'inbox',
              },
              {
                label: 'Candidates',
                path: '/company/recruitment/candidates',
                icon: 'users',
              },
              {
                label: 'Interviews',
                path: '/company/recruitment/interviews',
                icon: 'calendar',
              },
              { label: 'Offers', path: '/company/recruitment/offers', icon: 'file-text' },
              {
                label: 'Joining',
                path: '/company/recruitment/joining',
                icon: 'user-plus',
              },
            ],
          },
        ]
      : []),
    ...(canViewClients || canViewProjects || canViewSocial || canViewMeetings
      ? [
          {
            label: 'Delivery',
            items: [
              ...(canViewClients
                ? [{ label: 'Clients', path: '/company/clients', icon: 'briefcase' }]
                : []),
              ...(canViewProjects
                ? [{ label: 'Projects', path: '/company/projects', icon: 'grid' }]
                : []),
              ...(canViewMeetings
                ? [
                    {
                      label: 'Client meetings',
                      path: '/company/meetings',
                      icon: 'calendar',
                    },
                  ]
                : []),
              ...(canViewSocial
                ? [
                    {
                      label: 'Manage Social Media',
                      path: '/company/social',
                      icon: 'share',
                    },
                  ]
                : []),
            ],
          },
        ]
      : []),
    ...(canViewSeo
      ? [
          {
            label: 'SEO Intelligence',
            items: [
              {
                label: 'SEO Dashboard',
                path: '/company/seo-intelligence',
                icon: 'trending-up',
              },
            ],
          },
        ]
      : []),
    ...(canViewTerritories ||
    canViewLeads ||
    canViewCallbacks ||
    canViewCalls ||
    canManageCalls ||
    canViewHandovers ||
    canTriageSales ||
    canViewDeals ||
    canDecideApprovals ||
    canRecordWin ||
    canForecast
      ? [
          {
            label: 'Sales',
            items: [
              {
                label: 'Overview',
                path: '/company/sales',
                icon: 'chart',
              },
              ...(canViewLeads
                ? [
                    {
                      label: 'My Work',
                      path: '/company/sales/my-work',
                      icon: 'briefcase',
                    },
                  ]
                : []),
              ...(canViewLeads
                ? [
                    {
                      label: 'Lead Management',
                      path: '/company/sales/leads',
                      icon: 'users',
                      children: [
                        { label: 'All Leads', path: '/company/sales/leads' },
                        { label: 'Lead Pool', path: '/company/sales/bid-pool' },
                        { label: 'Inactive Leads', path: '/company/sales/leads/stalled' },
                        {
                          label: 'Follow-up Required',
                          path: '/company/sales/leads/re-engagement',
                        },
                        ...(canTriageSales
                          ? [{ label: 'Needs Review', path: '/company/sales/triage' }]
                          : []),
                        ...(canViewImports
                          ? [
                              {
                                label: 'Imported Leads',
                                path: '/company/sales/leads/imported',
                              },
                            ]
                          : []),
                      ],
                    },
                  ]
                : []),
              ...(canViewCallbacks || canViewHandovers || canViewCalls
                ? [
                    {
                      label: 'Activities',
                      path: canViewCallbacks
                        ? '/company/sales/callbacks'
                        : canViewHandovers
                          ? '/company/sales/handovers'
                          : '/company/sales/calls',
                      icon: 'calendar',
                      children: [
                        ...(canViewCallbacks
                          ? [{ label: 'Callbacks', path: '/company/sales/callbacks' }]
                          : []),
                        ...(canViewHandovers
                          ? [{ label: 'Handovers', path: '/company/sales/handovers' }]
                          : []),
                        ...(canViewCalls
                          ? [
                              { label: 'Calls', path: '/company/sales/calls' },
                              { label: 'My calls', path: '/company/sales/calls/me' },
                              { label: 'Call log', path: '/company/sales/calls/log' },
                            ]
                          : []),
                        ...(canTrackAssignedCalls
                          ? [
                              {
                                label: 'Assigned lead calls',
                                path: '/company/sales/calls/assigned-leads',
                              },
                            ]
                          : []),
                      ],
                    },
                  ]
                : []),
              ...(canViewDeals || canDecideApprovals || canRecordWin
                ? [
                    {
                      label: 'Deals',
                      path: '/company/sales/deals',
                      icon: 'briefcase',
                      children: [
                        ...(canViewDeals
                          ? [{ label: 'Pipeline', path: '/company/sales/deals' }]
                          : []),
                        ...(canDecideApprovals
                          ? [{ label: 'Approvals', path: '/company/sales/approvals' }]
                          : []),
                        ...(canRecordWin
                          ? [{ label: 'Wins to record', path: '/company/sales/wins' }]
                          : []),
                      ],
                    },
                  ]
                : []),
              ...(canForecast || canTriageSales
                ? [
                    {
                      label: 'Performance',
                      path: canForecast
                        ? '/company/sales/reports'
                        : '/company/sales/supervisor',
                      icon: 'chart',
                      children: [
                        ...(canTriageSales
                          ? [
                              {
                                label: 'Team overview',
                                path: '/company/sales/supervisor',
                              },
                            ]
                          : []),
                        ...(canForecast
                          ? [{ label: 'Reports', path: '/company/sales/reports' }]
                          : []),
                      ],
                    },
                  ]
                : []),
              {
                label: 'Setup',
                path: '/company/sales/setup',
                icon: 'settings',
                children: [
                  ...(canViewTerritories
                    ? [
                        {
                          label: 'Territories & routing',
                          path: '/company/sales/territories',
                        },
                      ]
                    : []),
                  ...(canViewLeads
                    ? [{ label: 'Lead sources', path: '/company/sales/leads' }]
                    : []),
                  ...(canManageCalls
                    ? [
                        {
                          label: 'Call integrations',
                          path: '/company/sales/call-integrations',
                        },
                      ]
                    : []),
                ],
              },
            ],
          },
        ]
      : []),
    {
      label: 'Attendance',
      items: [
        ...(accountType === 'employee' && moduleOn('attendance')
          ? [
              { label: 'Today', path: '/company/attendance/today', icon: 'clock' },
              {
                label: 'My Attendance',
                path: '/company/attendance/my',
                icon: 'calendar',
              },
            ]
          : []),
        ...(canViewAttendanceReports && moduleOn('attendance')
          ? [
              {
                label: 'Employee Wise',
                path: '/company/attendance/employee-wise',
                icon: 'users',
              },
            ]
          : []),
        ...(canViewAttendanceReports && moduleOn('attendance')
          ? [
              {
                label: 'Attendance Report',
                path: '/company/attendance/report',
                icon: 'grid',
              },
            ]
          : []),
        ...(canViewAttendanceReports && moduleOn('attendance')
          ? [
              {
                label: 'Daily Late Report',
                path: '/company/attendance/late',
                icon: 'clock',
              },
            ]
          : []),
        ...(canViewLiveBoard && moduleOn('live-status')
          ? [
              {
                label: 'Workforce Board',
                path: '/company/attendance/live',
                icon: 'users',
              },
            ]
          : []),
        ...(canReviewCorrections
          ? [
              {
                label: 'Corrections',
                path: '/company/attendance/corrections',
                icon: 'edit',
              },
            ]
          : []),
        ...(canReviewBreaches
          ? [
              {
                label: 'Break Queue',
                path: '/company/breaks/queue',
                icon: 'alert-circle',
              },
            ]
          : []),
        ...(canManageBreakPolicies
          ? [
              {
                label: 'Break Policies',
                path: '/company/breaks/policies',
                icon: 'settings',
              },
            ]
          : []),
        ...(canManageBiometric
          ? [{ label: 'Biometric', path: '/company/biometric', icon: 'cpu' }]
          : []),
      ],
    },
    {
      label: 'Shifts & Leave',
      items: [
        ...(moduleOn('leave')
          ? [{ label: 'My Leave', path: '/company/leave/my', icon: 'sun' }]
          : []),
        ...(canUseLeaveQueue
          ? [{ label: 'Leave Queue', path: '/company/leave/queue', icon: 'inbox' }]
          : []),
        ...(canViewLeaveBalances
          ? [{ label: 'Leave Balances', path: '/company/leave/balances', icon: 'chart' }]
          : []),
        ...(canManageLeaveTypes
          ? [{ label: 'Leave Types', path: '/company/leave/types', icon: 'settings' }]
          : []),
        ...(moduleOn('holidays')
          ? [{ label: 'Holidays', path: '/company/holidays', icon: 'flag' }]
          : []),
        ...(canManageShifts
          ? [
              { label: 'Shifts', path: '/company/shifts', icon: 'layers' },
              {
                label: 'Weekday Schedules',
                path: '/company/weekday-schedules',
                icon: 'calendar',
              },
            ]
          : []),
      ],
    },
    ...(canViewAdvances ||
    canManageAdvances ||
    canViewPenalties ||
    canManagePenalties ||
    canViewExpenses ||
    canApproveExpenses ||
    canViewTa
      ? [
          {
            label: 'Advances & Penalties',
            items: [
              ...(canViewAdvances
                ? [
                    {
                      label: 'My Advances',
                      path: '/company/advance/mine',
                      icon: 'dollar-sign',
                    },
                  ]
                : []),
              ...(canManageAdvances
                ? [
                    {
                      label: 'Advance Requests',
                      path: '/company/advance/requests',
                      icon: 'inbox',
                    },
                  ]
                : []),
              ...(canManagePenalties
                ? [
                    {
                      label: 'Penalties',
                      path: '/company/penalties',
                      icon: 'alert-circle',
                    },
                  ]
                : !canManageAdvances && canViewPenalties
                  ? [
                      {
                        label: 'Penalties',
                        path: '/company/my-penalties',
                        icon: 'alert-circle',
                      },
                    ]
                  : []),
              ...(canViewExpenses
                ? [
                    {
                      label: 'My Expenses',
                      path: '/company/expenses/mine',
                      icon: 'file-text',
                    },
                  ]
                : []),
              ...(canApproveExpenses
                ? [
                    {
                      label: 'Expense Approvals',
                      path: '/company/expenses/approvals',
                      icon: 'inbox',
                    },
                  ]
                : []),
              ...(canManageTa
                ? [{ label: 'TA Management', path: '/company/ta', icon: 'map' }]
                : canViewTa
                  ? [{ label: 'My TA', path: '/company/my-ta', icon: 'map' }]
                  : []),
            ],
          },
        ]
      : []),
    {
      label: 'Payroll',
      items: [
        ...(moduleOn('payroll')
          ? [
              {
                label: 'My Payslips',
                path: '/company/payroll/my-payslips',
                icon: 'file-text',
              },
            ]
          : []),
        ...(canManagePayroll
          ? [
              {
                label: 'Payroll Cycle',
                path: '/company/payroll/cycle',
                icon: 'calendar',
              },
              {
                label: 'Payroll Runs',
                path: '/company/payroll/runs',
                icon: 'dollar-sign',
              },
              {
                label: 'Salary Structures',
                path: '/company/payroll/salaries',
                icon: 'briefcase',
              },
              {
                label: 'Bonuses & Deductions',
                path: '/company/payroll/inputs',
                icon: 'chart',
              },
            ]
          : []),
        ...(canManagePayrollConfig
          ? [
              {
                label: 'Payroll Settings',
                path: '/company/payroll/settings',
                icon: 'wallet',
              },
            ]
          : []),
      ],
    },
    {
      label: 'Finance',
      items: canViewAccounting
        ? [
            {
              label: 'Accounting',
              path: '/company/finance/accounting',
              icon: 'wallet',
            },
          ]
        : [],
    },
    {
      label: 'Identity & Access',
      items: [
        { label: 'Sessions & Devices', path: '/company/sessions', icon: 'monitor' },
        ...(isSuperAdmin || canViewAccessExplorer
          ? [{ label: 'Access Explorer', path: '/company/access', icon: 'shield' }]
          : []),
        ...(isSuperAdmin || canViewAudit
          ? [{ label: 'Audit Log', path: '/company/audit', icon: 'clipboard-list' }]
          : []),
        ...(isSuperAdmin && moduleOn('attendance')
          ? [{ label: 'Geofencing', path: '/company/geofencing', icon: 'pin' }]
          : []),
        ...(accountType === 'employee' && canRequestRoleChange
          ? [
              {
                label: 'Request Role Change',
                path: '/company/role-change-request',
                icon: 'briefcase',
              },
            ]
          : []),
      ],
    },
    {
      label: 'Preferences',
      items: [{ label: 'Settings', path: '/company/settings', icon: 'settings' }],
    },
  ];
  return (
    variant === 'client'
      ? [
          {
            label: 'Overview',
            items: [
              { label: 'Dashboard', path: '/client', icon: 'grid' },
              { label: 'Projects', path: '/client/projects', icon: 'briefcase' },
              { label: 'Messages', path: '/client/messages', icon: 'message' },
              { label: 'Meetings', path: '/client/meetings', icon: 'calendar' },
              { label: 'Social accounts', path: '/client/social', icon: 'share' },
            ],
          },
          {
            label: 'Account',
            items: [
              { label: 'Profile', path: '/client/profile', icon: 'users' },
              { label: 'Settings', path: '/client/settings', icon: 'settings' },
            ],
          },
        ]
      : variant === 'platform'
        ? [
            {
              label: 'Platform',
              items: [
                { label: 'Platform Dashboard', path: '/platform', icon: 'grid' },
                { label: 'Companies', path: '/platform/companies', icon: 'building' },
                {
                  label: 'Admin Invitations',
                  path: '/platform/invitations',
                  icon: 'users',
                },
                { label: 'Mail Center', path: '/platform/mail', icon: 'inbox' },
              ],
            },
          ]
        : navigation.filter(
            (group) =>
              (group.items.length > 0 ||
                group.label === 'Payroll' ||
                group.label === 'Finance'),
          )
  );
}
