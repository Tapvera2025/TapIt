export interface CompanyNavItem { label: string; path: string; icon: string }
export interface CompanyNavGroup { label: string; items: CompanyNavItem[] }

export const companyNavigation: CompanyNavGroup[] = [
  { label: 'Overview', items: [{ label: 'Dashboard', path: '/company/dashboard', icon: 'grid' }] },
  { label: 'People', items: [{ label: 'Employees', path: '/company/employees', icon: 'users' }] },
  { label: 'Identity & Access', items: [
    { label: 'Sessions & Devices', path: '/company/sessions', icon: 'monitor' },
    { label: 'Geofencing', path: '/company/geofencing', icon: 'pin' },
  ] },
];
