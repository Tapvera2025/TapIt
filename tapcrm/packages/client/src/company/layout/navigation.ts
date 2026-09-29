import type { Action } from '@tapcrm/contracts';

export interface CompanyNavItem {
  label: string;
  path: string;
  icon: string;
  requiredAction?: Action;
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

export const companyNavigation: CompanyNavGroup[] = [
  {
    label: 'Overview',
    items: [{ label: 'Dashboard', path: '/company/dashboard', icon: 'grid' }],
  },
  {
    label: 'People',
    items: [{ label: 'Employees', path: '/company/employees', icon: 'users', requiredAction: 'users:view' }],
  },
  {
    label: 'Organization',
    items: [
      { label: 'Overview', path: '/company/organization', icon: 'grid', requiredAction: 'org:view-structure' },
      {
        label: 'Departments',
        path: '/company/organization/departments',
        icon: 'building',
        requiredAction: 'org:view-structure',
      },
      { label: 'Teams', path: '/company/organization/teams', icon: 'users', requiredAction: 'org:view-structure' },
      { label: 'Positions', path: '/company/organization/positions', icon: 'briefcase', requiredAction: 'org:view-structure' },
      {
        label: 'Designations',
        path: '/company/organization/designations',
        icon: 'briefcase',
        requiredAction: 'org:view-structure',
      },
      { label: 'Reporting', path: '/company/organization/reporting', icon: 'users', requiredAction: 'org:view-structure' },
      { label: 'Org Chart', path: '/company/organization/org-chart', icon: 'grid', requiredAction: 'org:view-structure' },
    ],
  },
  {
    label: 'Identity & Access',
    items: [
      { label: 'Sessions & Devices', path: '/company/sessions', icon: 'monitor' },
      { label: 'Geofencing', path: '/company/geofencing', icon: 'pin', requiredAction: 'identity:manage-geofence' },
      { label: 'Access Explorer', path: '/company/access', icon: 'shield', requiredAction: 'access:view' },
      { label: 'Audit Log', path: '/company/audit', icon: 'clipboard', requiredAction: 'audit:view' },
    ],
  },
  {
    label: 'Attendance',
    items: [
      { label: 'Today', path: '/company/attendance/today', icon: 'clock' },
      { label: 'My Attendance', path: '/company/attendance/my', icon: 'calendar' },
      { label: 'Workforce Board', path: '/company/attendance/live', icon: 'users', requiredAction: 'attendance:view-live' },
      { label: 'Corrections', path: '/company/attendance/corrections', icon: 'edit', requiredAction: 'attendance:correct' },
      { label: 'Break Queue', path: '/company/breaks/queue', icon: 'alert-circle', requiredAction: 'breaks:review-breach' },
      { label: 'Break Policies', path: '/company/breaks/policies', icon: 'settings', requiredAction: 'breaks:manage-policy' },
      { label: 'Biometric', path: '/company/biometric', icon: 'cpu', requiredAction: 'biometric:manage' },
    ],
  },
  {
    label: 'Shifts & Leave',
    items: [
      { label: 'My Leave', path: '/company/leave/my', icon: 'sun' },
      { label: 'Leave Queue', path: '/company/leave/queue', icon: 'inbox', requiredAction: 'leave:decide' },
      { label: 'Holidays', path: '/company/holidays', icon: 'flag' },
      { label: 'Shifts', path: '/company/shifts', icon: 'layers', requiredAction: 'shifts:manage' },
    ],
  },
  {
    label: 'Payroll',
    items: [
      { label: 'My Payslips', path: '/company/payroll/my-payslips', icon: 'file-text', requiredAction: 'payroll:view' },
      { label: 'Payroll Runs', path: '/company/payroll/runs', icon: 'dollar-sign', requiredAction: 'payroll:manage' },
    ],
  },
];

/**
 * Derive screen metadata from the one navigation registry used by the
 * workspace. Access Explorer uses this for both reachable screens and the
 * action-to-screen explanation; it is not a second authorization catalogue.
 */
export function navigationScreensForActions(actions: ReadonlySet<Action>): CompanyScreen[] {
  const seen = new Set<string>();
  return companyNavigation
    .flatMap((group) => group.items)
    .filter((item): item is CompanyNavItem & { requiredAction: Action } =>
      item.requiredAction !== undefined && actions.has(item.requiredAction),
    )
    .filter((item) => {
      if (seen.has(item.path)) return false;
      seen.add(item.path);
      return true;
    })
    .map(({ label, path, requiredAction }) => ({ label, path, requiredAction }));
}

export function navigationScreensByAction(): ReadonlyMap<Action, readonly CompanyScreen[]> {
  const mapping = new Map<Action, CompanyScreen[]>();
  for (const group of companyNavigation) {
    for (const item of group.items) {
      if (item.requiredAction === undefined) continue;
      const screens = mapping.get(item.requiredAction) ?? [];
      screens.push({ label: item.label, path: item.path, requiredAction: item.requiredAction });
      mapping.set(item.requiredAction, screens);
    }
  }
  return mapping;
}
