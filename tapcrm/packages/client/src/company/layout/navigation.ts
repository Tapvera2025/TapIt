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
        icon: 'clipboard',
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
