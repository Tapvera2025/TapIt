export interface CompanyNavItem {
  label: string;
  path: string;
  icon: string;
}
export interface CompanyNavGroup {
  label: string;
  items: CompanyNavItem[];
}

export const companyNavigation: CompanyNavGroup[] = [
  {
    label: 'Overview',
    items: [{ label: 'Dashboard', path: '/company/dashboard', icon: 'grid' }],
  },
  {
    label: 'People',
    items: [{ label: 'Employees', path: '/company/employees', icon: 'users' }],
  },
  {
    label: 'Organization',
    items: [
      { label: 'Overview', path: '/company/organization', icon: 'grid' },
      {
        label: 'Departments',
        path: '/company/organization/departments',
        icon: 'building',
      },
      { label: 'Teams', path: '/company/organization/teams', icon: 'users' },
      { label: 'Positions', path: '/company/organization/positions', icon: 'briefcase' },
      {
        label: 'Designations',
        path: '/company/organization/designations',
        icon: 'briefcase',
      },
      { label: 'Reporting', path: '/company/organization/reporting', icon: 'users' },
      { label: 'Org Chart', path: '/company/organization/org-chart', icon: 'grid' },
    ],
  },
  {
    label: 'Identity & Access',
    items: [
      { label: 'Sessions & Devices', path: '/company/sessions', icon: 'monitor' },
      { label: 'Geofencing', path: '/company/geofencing', icon: 'pin' },
    ],
  },
];
