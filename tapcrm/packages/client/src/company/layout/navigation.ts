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
