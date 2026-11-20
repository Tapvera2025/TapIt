import { describe, expect, it } from 'vitest';
import { buildSidebarNavigation } from './sidebarNavigation.js';
import { isDestinationModuleEnabled } from './navigation.js';

const labels = (groups: ReturnType<typeof buildSidebarNavigation>): string[] =>
  groups.flatMap((group) => group.items.flatMap((item) => [item.label, ...(item.children ?? []).map((child) => child.label)]));
const groupNames = (groups: ReturnType<typeof buildSidebarNavigation>): string[] =>
  groups.map((group) => group.label);

describe('buildSidebarNavigation: switched-off modules', () => {
  // The Super Admin holds every power of every enabled module.
  const superAdmin = { accountType: 'super-admin' };

  it('offers a module only while it is enabled, super-admin included', () => {
    const on = buildSidebarNavigation({
      ...superAdmin,
      enabledModules: ['identity', 'organization', 'payroll', 'attendance', 'accounting', 'social', 'seo-intelligence', 'leads'],
    });
    expect(labels(on)).toContain('Payroll Runs');

    const off = buildSidebarNavigation({ ...superAdmin, enabledModules: ['identity', 'organization'] });
    expect(labels(off)).not.toContain('Payroll Runs');
    expect(labels(off)).not.toContain('My Payslips');
    expect(labels(off)).not.toContain('Accounting');
    expect(labels(off)).not.toContain('Manage Social Media');
    expect(labels(off)).not.toContain('SEO Dashboard');
    expect(labels(off)).not.toContain('Attendance Report');
    expect(groupNames(off)).not.toContain('Payroll');
    expect(groupNames(off)).not.toContain('Finance');
  });

  it('removes a group once none of its entries are left', () => {
    const off = buildSidebarNavigation({ ...superAdmin, enabledModules: ['identity'] });
    for (const group of off) expect(group.items.length).toBeGreaterThan(0);
  });

  it('keeps everything when the company module list is not known yet', () => {
    const unknown = buildSidebarNavigation({ ...superAdmin });
    expect(labels(unknown)).toContain('Payroll Runs');
  });

  it('never shows an expandable entry with nothing inside it', () => {
    const none = buildSidebarNavigation({
      accountType: 'employee',
      capabilities: [{ action: 'callbacks:view', scope: 'team' }],
    });
    for (const group of none) {
      for (const item of group.items) {
        if (item.children) expect(item.children.length).toBeGreaterThan(0);
      }
    }
  });

  it('leaves the fixed client and platform menus untouched', () => {
    expect(labels(buildSidebarNavigation({ variant: 'client', accountType: 'client', enabledModules: [] }))).toContain('Projects');
    expect(labels(buildSidebarNavigation({ variant: 'platform', accountType: 'super-admin', enabledModules: [] }))).toContain('Companies');
  });
});

describe('buildSidebarNavigation: position powers', () => {
  const employee = (capabilities: { action: string; scope: string }[]) =>
    labels(buildSidebarNavigation({ accountType: 'employee', capabilities }));

  it('shows an entry exactly when the power behind its page is held', () => {
    expect(employee([])).not.toContain('Tasks');
    expect(employee([{ action: 'tasks:view', scope: 'own' }])).toContain('Tasks');
    expect(employee([])).not.toContain('My Payslips');
    expect(employee([{ action: 'payroll:view', scope: 'own' }])).toContain('My Payslips');
    expect(employee([])).not.toContain('Holidays');
    expect(employee([{ action: 'holidays:view', scope: 'department' }])).toContain('Holidays');
  });

  it('needs reach beyond the holder for screens about other people', () => {
    expect(employee([{ action: 'attendance:view', scope: 'own' }])).not.toContain('Attendance Report');
    expect(employee([{ action: 'attendance:view', scope: 'team' }])).toContain('Attendance Report');
    expect(employee([{ action: 'advance:view', scope: 'own' }])).not.toContain('Advance Requests');
    expect(employee([{ action: 'advance:view', scope: 'team' }])).toContain('Advance Requests');
  });

  it('lists a person\'s own penalties and TA next to the management screens', () => {
    const hr = employee([
      { action: 'penalty:view', scope: 'all-people' },
      { action: 'penalty:view-own', scope: 'own' },
      { action: 'ta:view', scope: 'all-people' },
      { action: 'ta:manage', scope: 'all-people' },
      { action: 'ta:view-own', scope: 'own' },
      // TA Management loads the people and departments alongside the report.
      { action: 'users:view', scope: 'all-people' },
      { action: 'org:view-structure', scope: 'department' },
    ]);
    for (const label of ['Penalties', 'My Penalties', 'TA Management', 'My TA']) expect(hr).toContain(label);
  });

  it('offers Organization and Geofencing screens to positions given those powers', () => {
    const admin = employee([
      { action: 'org:view-structure', scope: 'department' },
      { action: 'org:manage-teams', scope: 'department' },
      { action: 'identity:manage-geofence', scope: 'all-people' },
    ]);
    expect(admin).toContain('Teams');
    expect(admin).toContain('Org Chart');
    expect(admin).toContain('Geofencing');
    // Editors need the power that saves them.
    expect(admin).not.toContain('Departments');
    expect(admin).not.toContain('Positions');
  });

  it('opens a parent entry on the first sub-entry the person has', () => {
    const groups = buildSidebarNavigation({
      accountType: 'employee',
      capabilities: [{ action: 'approvals:decide', scope: 'team' }],
    });
    const deals = groups.flatMap((group) => group.items).find((item) => item.label === 'Deals');
    expect(deals?.path).toBe('/company/sales/approvals');
    expect(deals?.children?.map((child) => child.label)).toEqual(['Approvals']);
  });
});

describe('isDestinationModuleEnabled', () => {
  it('judges a deep route by the screen that owns it', () => {
    expect(isDestinationModuleEnabled('/company/payroll/runs/2026-11', ['identity'])).toBe(false);
    expect(isDestinationModuleEnabled('/company/payroll/runs/2026-11', ['payroll'])).toBe(true);
  });

  it('allows paths no screen owns and an unknown module list', () => {
    expect(isDestinationModuleEnabled('/company/something-new', ['identity'])).toBe(true);
    expect(isDestinationModuleEnabled('/company/payroll/runs', undefined)).toBe(true);
  });
});
