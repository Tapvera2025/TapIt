import { describe, expect, it } from 'vitest';
import { buildSidebarNavigation } from './sidebarNavigation.js';
import { isDestinationModuleEnabled } from './navigation.js';

const labels = (groups: ReturnType<typeof buildSidebarNavigation>): string[] =>
  groups.flatMap((group) => group.items.map((item) => item.label));
const groupNames = (groups: ReturnType<typeof buildSidebarNavigation>): string[] =>
  groups.map((group) => group.label);

describe('buildSidebarNavigation: switched-off modules', () => {
  const superAdmin = {
    accountType: 'super-admin',
    canManagePayroll: true,
    canManagePayrollConfig: true,
    canViewAccounting: true,
    canViewSocial: true,
    canViewSeo: true,
    canViewLeads: true,
    canViewAttendanceReports: true,
  };

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
    const none = buildSidebarNavigation({ accountType: 'employee', canViewLeads: false, canViewCallbacks: true });
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

describe('isDestinationModuleEnabled', () => {
  it('judges a deep route by the registry entry that owns it', () => {
    expect(isDestinationModuleEnabled('/company/payroll/runs/2026-11', ['identity'])).toBe(false);
    expect(isDestinationModuleEnabled('/company/payroll/runs/2026-11', ['payroll'])).toBe(true);
  });

  it('allows paths the registry does not know and an unknown module list', () => {
    expect(isDestinationModuleEnabled('/company/something-new', ['identity'])).toBe(true);
    expect(isDestinationModuleEnabled('/company/payroll/runs', undefined)).toBe(true);
  });
});
