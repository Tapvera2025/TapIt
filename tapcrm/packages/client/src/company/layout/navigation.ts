export interface CompanyNavSubItem {
  label: string;
  path: string;
}
import type { Action } from '@tapcrm/contracts';

export interface CompanyNavItem {
  label: string;
  path: string;
  icon: string;
  children?: CompanyNavSubItem[];
  requiredAction?: Action;
  requiredAnyAction?: readonly Action[];
}
export interface CompanyNavGroup {
  label: string;
  items: CompanyNavItem[];
}

export interface CompanyScreen {
  label: string;
  path: string;
  requiredAction: Action;
}

export interface CompanySearchDestination {
  label: string;
  path: string;
  icon: string;
  category: string;
  keywords: readonly string[];
}

const SEARCH_ALIASES_BY_PATH: Readonly<Record<string, readonly string[]>> = {
  '/company/holidays': ['holiday calendar', 'public holidays', 'festivals', 'weekend', 'weekends', 'week off', 'week-off', 'days off'],
  '/company/attendance/my': ['attendance calendar', 'work calendar', 'work day', 'work days', 'punch history'],
  '/company/attendance/live': ['workforce', 'workforce board', 'live workforce', 'employee live board', 'presence', 'live attendance'],
  '/company/audit': ['audit', 'audit trail', 'activity log', 'activity records', 'security log', 'history', 'records'],
  '/company/sessions': ['login', 'logins', 'logged in devices', 'active devices', 'security sessions'],
  '/company/sales/deals': ['sales pipeline', 'opportunities', 'business deals'],
  '/company/sales/wins': ['record', 'records', 'record win', 'won deals', 'successful deals'],
  '/company/sales/reports': ['sales forecast', 'forecast', 'sales analytics'],
  '/company/weekday-schedules': ['weekday', 'working days', 'weekends', 'schedule', 'work schedule'],
  '/company/payroll/cycle': ['payroll period', 'pay run', 'salary cycle'],
  '/company/finance/accounting': ['accounts', 'ledger', 'finance', 'financial records'],
};

/**
 * Single universal navigation item for My Todo.
 * Universally available to all authenticated company users without action or role gating.
 */
export const myTodoNavItem: CompanyNavItem = {
  label: 'My Todo',
  path: '/company/todo',
  icon: 'pencil',
};

export const myTodoItem = myTodoNavItem;

/**
 * Single universal navigation item for My Notepad.
 * Universally available to all authenticated company users without action or role gating.
 */
export const myNotepadNavItem: CompanyNavItem = {
  label: 'My Notepad',
  path: '/company/my-notepad',
  icon: 'notepad',
};

export const myNotepadItem = myNotepadNavItem;

export const companyNavigation: CompanyNavGroup[] = [
  {
    label: 'Overview',
    items: [
      { label: 'Dashboard', path: '/company/dashboard', icon: 'grid' },
      { label: 'Tasks', path: '/company/tasks', icon: 'check' },
      myTodoNavItem,
      myNotepadNavItem,
    ],
  },
  {
    label: 'Communication',
    items: [
      {
        label: 'Messages',
        path: '/company/messages',
        icon: 'message',
        requiredAction: 'chat:view',
      },
    ],
  },
  {
    label: 'Delivery',
    items: [
      {
        label: 'Clients',
        path: '/company/clients',
        icon: 'briefcase',
        requiredAction: 'clients:view',
      },
      {
        label: 'Projects',
        path: '/company/projects',
        icon: 'grid',
        requiredAction: 'projects:view',
      },
    ],
  },
  {
    label: 'People',
    items: [
      {
        label: 'Employees',
        path: '/company/employees',
        icon: 'users',
        requiredAction: 'users:view',
      },
      {
        label: 'Employee Notes',
        path: '/company/employee-notes',
        icon: 'notepad',
        requiredAction: 'notepad:view-all',
      },
      {
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
      },
    ],
  },
  {
    label: 'Sales',
    items: [
      {
        label: 'Sales Overview',
        path: '/company/sales',
        icon: 'chart',
        requiredAnyAction: ['territories:view', 'leads:view', 'callbacks:view', 'handovers:view', 'deals:view', 'deals:record-win', 'approvals:decide', 'deals:forecast', 'telephony:view', 'telephony:manage'],
      },
      {
        label: 'My Work',
        path: '/company/sales/my-work',
        icon: 'briefcase',
        requiredAction: 'leads:view',
      },
      {
        label: 'Bid Pool',
        path: '/company/sales/bid-pool',
        icon: 'inbox',
        requiredAction: 'leads:view',
      },
      {
        label: 'Leads',
        path: '/company/sales/leads',
        icon: 'users',
        requiredAction: 'leads:view',
      },
      {
        label: 'Deals',
        path: '/company/sales/deals',
        icon: 'briefcase',
        requiredAction: 'deals:view',
      },
      {
        label: 'Approvals',
        path: '/company/sales/approvals',
        icon: 'check',
        requiredAction: 'approvals:decide',
      },
      {
        label: 'Wins to record',
        path: '/company/sales/wins',
        icon: 'check',
        requiredAction: 'deals:record-win',
      },
      {
        label: 'Reports',
        path: '/company/sales/reports',
        icon: 'chart',
        requiredAction: 'deals:forecast',
      },
      {
        label: 'Sales Setup',
        path: '/company/sales/setup',
        icon: 'settings',
        requiredAnyAction: ['territories:view', 'leads:view', 'telephony:view', 'telephony:manage'],
      },
      {
        label: 'Territories',
        path: '/company/sales/territories',
        icon: 'map',
        requiredAction: 'territories:view',
      },
      {
        label: 'Leads',
        path: '/company/sales/leads',
        icon: 'users',
        requiredAction: 'leads:view',
      },
      {
        label: 'Callbacks',
        path: '/company/sales/callbacks',
        icon: 'calendar',
        requiredAction: 'callbacks:view',
      },
      {
        label: 'Handovers',
        path: '/company/sales/handovers',
        icon: 'share',
        requiredAction: 'handovers:view',
      },
      {
        label: 'Calls',
        path: '/company/sales/calls',
        icon: 'phone',
        requiredAction: 'telephony:view',
        children: [
          { label: 'Team calls', path: '/company/sales/calls' },
          { label: 'My calls', path: '/company/sales/calls/me' },
          { label: 'Call log', path: '/company/sales/calls/log' },
          { label: 'Assigned lead calls', path: '/company/sales/calls/assigned-leads' },
        ],
      },
      {
        label: 'Imported leads',
        path: '/company/sales/leads/imported',
        icon: 'upload',
        requiredAction: 'lead-imports:view',
      },
      {
        label: 'Call Integrations',
        path: '/company/sales/call-integrations',
        icon: 'settings',
        requiredAction: 'telephony:manage',
      },
    ],
  },
  {
    label: 'Organization',
    items: [
      {
        label: 'Overview',
        path: '/company/organization',
        icon: 'grid',
        requiredAction: 'org:view-structure',
      },
      {
        label: 'Departments',
        path: '/company/organization/departments',
        icon: 'building',
        requiredAction: 'org:view-structure',
      },
      {
        label: 'Teams',
        path: '/company/organization/teams',
        icon: 'users',
        requiredAction: 'org:view-structure',
      },
      {
        label: 'Positions',
        path: '/company/organization/positions',
        icon: 'briefcase',
        requiredAction: 'org:view-structure',
      },
      {
        label: 'Designations',
        path: '/company/organization/designations',
        icon: 'briefcase',
        requiredAction: 'org:view-structure',
      },
      {
        label: 'Reporting',
        path: '/company/organization/reporting',
        icon: 'users',
        requiredAction: 'org:view-structure',
      },
      {
        label: 'Org Chart',
        path: '/company/organization/org-chart',
        icon: 'hierarchy',
        requiredAction: 'org:view-structure',
      },
    ],
  },
  {
    label: 'Identity & Access',
    items: [
      { label: 'Sessions & Devices', path: '/company/sessions', icon: 'monitor' },
      {
        label: 'Geofencing',
        path: '/company/geofencing',
        icon: 'pin',
        requiredAction: 'identity:manage-geofence',
      },
      {
        label: 'Access Explorer',
        path: '/company/access',
        icon: 'shield',
        requiredAction: 'access:view',
      },
      {
        label: 'Audit Log',
        path: '/company/audit',
        icon: 'clipboard-list',
        requiredAction: 'audit:view',
      },
    ],
  },
  {
    label: 'Attendance',
    items: [
      { label: 'Today', path: '/company/attendance/today', icon: 'clock' },
      { label: 'My Attendance', path: '/company/attendance/my', icon: 'calendar' },
      {
        label: 'Employee Wise',
        path: '/company/attendance/employee-wise',
        icon: 'users',
        requiredAction: 'attendance:view',
      },
      {
        label: 'Attendance Report',
        path: '/company/attendance/report',
        icon: 'grid',
        requiredAction: 'attendance:view',
      },
      {
        label: 'Daily Late Report',
        path: '/company/attendance/late',
        icon: 'clock',
        requiredAction: 'attendance:view',
      },
      {
        label: 'Workforce Board',
        path: '/company/attendance/live',
        icon: 'users',
        requiredAction: 'attendance:view-live',
      },
      {
        label: 'Corrections',
        path: '/company/attendance/corrections',
        icon: 'edit',
        requiredAction: 'attendance:correct',
      },
      {
        label: 'Break Queue',
        path: '/company/breaks/queue',
        icon: 'alert-circle',
        requiredAction: 'breaks:review-breach',
      },
      {
        label: 'Break Policies',
        path: '/company/breaks/policies',
        icon: 'settings',
        requiredAction: 'breaks:manage-policy',
      },
      {
        label: 'Biometric',
        path: '/company/biometric',
        icon: 'cpu',
        requiredAction: 'biometric:manage',
      },
    ],
  },
  {
    label: 'Shifts & Leave',
    items: [
      { label: 'My Leave', path: '/company/leave/my', icon: 'sun' },
      {
        label: 'Leave Queue',
        path: '/company/leave/queue',
        icon: 'inbox',
        requiredAnyAction: ['leave:acknowledge', 'leave:decide'],
      },
      {
        label: 'Leave Balances',
        path: '/company/leave/balances',
        icon: 'chart',
        requiredAction: 'leave:manage-types',
      },
      {
        label: 'Leave Types',
        path: '/company/leave/types',
        icon: 'settings',
        requiredAction: 'leave:manage-types',
      },
      { label: 'Holidays', path: '/company/holidays', icon: 'flag' },
      {
        label: 'Shifts',
        path: '/company/shifts',
        icon: 'layers',
        requiredAction: 'shifts:manage',
      },
    ],
  },
  {
    label: 'Advances & Penalties',
    items: [
      {
        label: 'My Advances',
        path: '/company/advance/mine',
        icon: 'dollar-sign',
        requiredAction: 'advance:view-own',
      },
      {
        label: 'Advance Requests',
        path: '/company/advance/requests',
        icon: 'inbox',
        requiredAction: 'advance:view',
      },
      {
        label: 'Penalties',
        path: '/company/penalties',
        icon: 'alert-circle',
        requiredAction: 'penalty:view',
      },
      {
        label: 'My Penalties',
        path: '/company/my-penalties',
        icon: 'alert-circle',
        requiredAction: 'penalty:view-own',
      },
      {
        label: 'My Expenses',
        path: '/company/expenses/mine',
        icon: 'file-text',
        requiredAction: 'payables:claim',
      },
      {
        label: 'Expense Approvals',
        path: '/company/expenses/approvals',
        icon: 'inbox',
        requiredAction: 'payables:approve-claim',
      },
      {
        label: 'TA Management',
        path: '/company/ta',
        icon: 'map',
        requiredAction: 'ta:view',
      },
      {
        label: 'My TA',
        path: '/company/my-ta',
        icon: 'map',
        requiredAction: 'ta:view-own',
      },
    ],
  },
  {
    label: 'Payroll',
    items: [
      {
        label: 'My Payslips',
        path: '/company/payroll/my-payslips',
        icon: 'file-text',
        requiredAction: 'payroll:view',
      },
      {
        label: 'Payroll Runs',
        path: '/company/payroll/runs',
        icon: 'dollar-sign',
        requiredAction: 'payroll:manage',
      },
      {
        label: 'Salary Structures',
        path: '/company/payroll/salaries',
        icon: 'briefcase',
        requiredAction: 'payroll:manage',
      },
      {
        label: 'Bonuses & Deductions',
        path: '/company/payroll/inputs',
        icon: 'chart',
        requiredAction: 'payroll:manage',
      },
      {
        label: 'Payroll Settings',
        path: '/company/payroll/settings',
        icon: 'settings',
        requiredAction: 'payroll:manage-config',
      },
    ],
  },
];

/**
 * Derive screen metadata from the one navigation registry used by the
 * workspace. Access Explorer uses this for both reachable screens and the
 * action-to-screen explanation; it is not a second authorization catalogue.
 */
export function navigationScreensForActions(
  actions: ReadonlySet<Action>,
): CompanyScreen[] {
  const seen = new Set<string>();
  return companyNavigation
    .flatMap((group) => group.items)
    .map((item) => ({
      item,
      matchedAction:
        item.requiredAction !== undefined && actions.has(item.requiredAction)
          ? item.requiredAction
          : item.requiredAnyAction?.find((action) => actions.has(action)),
    }))
    .filter(
      (entry): entry is { item: CompanyNavItem; matchedAction: Action } =>
        entry.matchedAction !== undefined,
    )
    .filter((item) => {
      if (seen.has(item.item.path)) return false;
      seen.add(item.item.path);
      return true;
    })
    .map(({ item, matchedAction }) => ({
      label: item.label,
      path: item.path,
      requiredAction: matchedAction,
    }));
}

export function navigationScreensByAction(): ReadonlyMap<
  Action,
  readonly CompanyScreen[]
> {
  const mapping = new Map<Action, CompanyScreen[]>();
  for (const group of companyNavigation) {
    for (const item of group.items) {
      const requiredActions = [
        ...(item.requiredAction === undefined ? [] : [item.requiredAction]),
        ...(item.requiredAnyAction ?? []),
      ];
      for (const requiredAction of requiredActions) {
        const screens = mapping.get(requiredAction) ?? [];
        screens.push({ label: item.label, path: item.path, requiredAction });
        mapping.set(requiredAction, screens);
      }
    }
  }
  return mapping;
}

/**
 * Builds the feature-search index from the same navigation registry used by
 * the workspace navigation. Capability checks happen before results are
 * returned; route authorization remains authoritative at the server/router.
 */
export function companySearchDestinations({
  actions,
  isSuperAdmin = false,
  isHr = false,
  hasRecruitment = false,
  hasInterviews = false,
  accountType = 'employee',
}: {
  actions: ReadonlySet<Action>;
  isSuperAdmin?: boolean;
  isHr?: boolean;
  hasRecruitment?: boolean;
  hasInterviews?: boolean;
  accountType?: string;
}): CompanySearchDestination[] {
  const destinations: CompanySearchDestination[] = [];
  const seen = new Set<string>();

  const addDestination = (destination: CompanySearchDestination): void => {
    if (seen.has(destination.path)) return;
    seen.add(destination.path);
    const pathKeywords = destination.path
      .split('/')
      .filter(Boolean)
      .flatMap((segment) => segment.split(/[-_]/g));
    destinations.push({
      ...destination,
      keywords: [
        ...destination.keywords,
        ...pathKeywords,
        ...(SEARCH_ALIASES_BY_PATH[destination.path] ?? []),
      ],
    });
  };

  for (const group of companyNavigation) {
    for (const item of group.items) {
      if (item.label === 'Recruitment' && (!isHr || !hasRecruitment)) continue;
      if ((item.label === 'Access Explorer' || item.label === 'Geofencing') && !isSuperAdmin) continue;
      if (item.requiredAction && !isSuperAdmin && !actions.has(item.requiredAction))
        continue;
      if (
        item.requiredAnyAction &&
        !isSuperAdmin &&
        !item.requiredAnyAction.some((action) => actions.has(action))
      ) {
        continue;
      }

      const children = item.children?.length
        ? item.children
        : [{ label: item.label, path: item.path }];
      for (const child of children) {
        addDestination({
          label: child.label,
          path: child.path,
          icon: item.icon,
          category: group.label,
          keywords: [
            item.label,
            group.label,
            child.label,
            ...(SEARCH_ALIASES_BY_PATH[child.path] ?? SEARCH_ALIASES_BY_PATH[item.path] ?? []),
          ],
        });
      }
    }
  }

  const addIfAllowed = (
    destination: Omit<CompanySearchDestination, 'keywords'> & { keywords?: readonly string[] },
    requiredActions: readonly Action[] = [],
  ): void => {
    if (!isSuperAdmin && requiredActions.length > 0 && !requiredActions.some((action) => actions.has(action))) return;
    addDestination({
      ...destination,
      keywords: [destination.label, destination.category, ...(destination.keywords ?? [])],
    });
  };

  if (hasInterviews) {
    addIfAllowed({ label: 'My Interviews', path: '/company/my-interviews', icon: 'calendar', category: 'Overview', keywords: ['interview schedule'] });
  }
  addIfAllowed({ label: 'Deals', path: '/company/sales/deals', icon: 'briefcase', category: 'Sales', keywords: ['sales pipeline', 'opportunities'] }, ['deals:view']);
  addIfAllowed({ label: 'Approvals', path: '/company/sales/approvals', icon: 'check', category: 'Sales', keywords: ['approval requests'] }, ['approvals:decide']);
  addIfAllowed({ label: 'Wins to record', path: '/company/sales/wins', icon: 'check', category: 'Sales', keywords: ['record win', 'won deals'] }, ['deals:record-win']);
  addIfAllowed({ label: 'Reports', path: '/company/sales/reports', icon: 'chart', category: 'Sales', keywords: ['sales forecast', 'forecast'] }, ['deals:forecast']);
  addIfAllowed({ label: 'Weekday Schedules', path: '/company/weekday-schedules', icon: 'calendar', category: 'Shifts & Leave', keywords: ['weekday', 'working days', 'weekends'] }, ['shifts:manage']);
  addIfAllowed({ label: 'Payroll Cycle', path: '/company/payroll/cycle', icon: 'calendar', category: 'Payroll', keywords: ['payroll period', 'pay run'] }, ['payroll:manage']);
  addIfAllowed({ label: 'Accounting', path: '/company/finance/accounting', icon: 'wallet', category: 'Finance', keywords: ['accounts', 'ledger', 'finance'] }, ['accounting:view-ledger', 'accounting:view-statements', 'accounting:tax-export']);
  if (accountType === 'employee' && !isSuperAdmin) {
    addIfAllowed({ label: 'Request Role Change', path: '/company/role-change-request', icon: 'briefcase', category: 'Identity & Access', keywords: ['change role', 'designation'] }, ['access:request-role-change']);
  }

  if (!seen.has('/company/settings')) {
    destinations.push({
      label: 'Settings',
      path: '/company/settings',
      icon: 'settings',
      category: 'Preferences',
      keywords: ['settings', 'theme', 'appearance', 'display mode', 'color'],
    });
  }

  return destinations;
}
