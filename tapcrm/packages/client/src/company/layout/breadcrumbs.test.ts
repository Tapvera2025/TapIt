import { describe, expect, it } from 'vitest';
import { breadcrumbTrail } from './breadcrumbs.js';
import type { CompanyNavGroup } from './navigation.js';

const groups: CompanyNavGroup[] = [
  {
    label: 'Overview',
    items: [
      { label: 'Dashboard', path: '/company/dashboard', icon: 'grid' },
      { label: 'Tasks', path: '/company/tasks', icon: 'check' },
    ],
  },
  {
    label: 'Sales',
    items: [
      { label: 'Overview', path: '/company/sales', icon: 'chart' },
      {
        label: 'Lead Management',
        path: '/company/sales/leads',
        icon: 'users',
        children: [
          { label: 'All Leads', path: '/company/sales/leads' },
          { label: 'Lead Pool', path: '/company/sales/bid-pool' },
        ],
      },
    ],
  },
  { label: 'Finance', items: [{ label: 'Accounting', path: '/company/finance/accounting', icon: 'wallet' }] },
];

const trail = (pathname: string, pageTitle?: string, showGroup = true) =>
  breadcrumbTrail({ groups, pathname, pageTitle, homePath: '/company/dashboard', showGroup });
const labels = (pathname: string, pageTitle?: string) => trail(pathname, pageTitle).map((c) => c.label);

describe('breadcrumbTrail', () => {
  it('shows Home > Group > Entry, with the group as plain text and the page as current', () => {
    const crumbs = trail('/company/tasks');
    expect(crumbs.map((c) => c.label)).toEqual(['Home', 'Overview', 'Tasks']);
    expect(crumbs[0]).toMatchObject({ path: '/company/dashboard', icon: 'home' });
    expect(crumbs[1]!.path).toBeUndefined();
    expect(crumbs[2]).toMatchObject({ current: true });
    expect(crumbs[2]!.path).toBeUndefined();
  });

  it('omits Home on the home page itself', () => {
    expect(labels('/company/dashboard')).toEqual(['Overview', 'Dashboard']);
  });

  it('includes the sub-entry for nested menu pages', () => {
    expect(labels('/company/sales/bid-pool')).toEqual(['Home', 'Sales', 'Lead Management', 'Lead Pool']);
  });

  it('does not repeat a label when the group and entry share a name', () => {
    expect(labels('/company/sales')).toEqual(['Home', 'Sales', 'Overview']);
    const sameName: CompanyNavGroup[] = [{ label: 'Settings', items: [{ label: 'Settings', path: '/company/settings', icon: 'settings' }] }];
    expect(
      breadcrumbTrail({ groups: sameName, pathname: '/company/settings', homePath: '/company/dashboard' }).map((c) => c.label),
    ).toEqual(['Home', 'Settings']);
  });

  it('adds the page title for routes deeper than the menu (detail pages)', () => {
    expect(labels('/company/sales/leads/42', 'Acme Corp lead')).toEqual([
      'Home',
      'Sales',
      'Lead Management',
      'Acme Corp lead',
    ]);
    // ...but never when it would only repeat the entry itself.
    expect(labels('/company/tasks/9', 'Tasks')).toEqual(['Home', 'Overview', 'Tasks']);
  });

  it('prefers the longest matching entry, not a shorter ancestor', () => {
    expect(labels('/company/sales/leads')).toEqual(['Home', 'Sales', 'Lead Management']);
  });

  it('falls back to the page title for a route outside the menu', () => {
    expect(labels('/company/somewhere-new', 'Somewhere new')).toEqual(['Home', 'Somewhere new']);
    expect(labels('/company/somewhere-new')).toEqual(['Home']);
  });

  it('can hide groups for the small fixed menus', () => {
    expect(trail('/company/tasks', undefined, false).map((c) => c.label)).toEqual(['Home', 'Tasks']);
  });
});
