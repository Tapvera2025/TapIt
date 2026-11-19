import { describe, expect, it } from 'vitest';
import type { AppNotification } from '../../notifications/api/notificationsApi.js';
import type { CompanyNavGroup } from './navigation.js';
import {
  computeSidebarBadges,
  destinationFor,
  destinationPaths,
  formatBadgeCount,
} from './sidebarBadges.js';

const groups: CompanyNavGroup[] = [
  {
    label: 'Overview',
    items: [
      { label: 'Dashboard', path: '/company/dashboard', icon: 'grid' },
      { label: 'Tasks', path: '/company/tasks', icon: 'check' },
      { label: 'Messages', path: '/company/messages', icon: 'message' },
    ],
  },
  {
    label: 'Sales',
    items: [
      { label: 'Overview', path: '/company/sales', icon: 'chart' },
      {
        label: 'Activities',
        path: '/company/sales/callbacks',
        icon: 'calendar',
        children: [
          { label: 'Callbacks', path: '/company/sales/callbacks' },
          { label: 'Handovers', path: '/company/sales/handovers' },
        ],
      },
    ],
  },
  {
    label: 'Shifts & Leave',
    items: [
      { label: 'My Leave', path: '/company/leave/my', icon: 'sun' },
      { label: 'Leave Queue', path: '/company/leave/queue', icon: 'inbox' },
    ],
  },
];

function note(partial: Partial<AppNotification> & Pick<AppNotification, 'type'>): AppNotification {
  return {
    id: partial.id ?? `${partial.type}-${Math.random()}`,
    priority: 'informational',
    title: 't',
    body: 'b',
    link: null,
    metadata: {},
    read: false,
    readAt: null,
    createdAt: '2026-11-19T00:00:00Z',
    ...partial,
  };
}

describe('destinationPaths', () => {
  it('lists entries and sub-entries once each', () => {
    const paths = destinationPaths(groups);
    expect(paths).toContain('/company/sales/handovers');
    expect(paths.filter((p) => p === '/company/sales/callbacks')).toHaveLength(1);
  });
});

describe('destinationFor', () => {
  const paths = destinationPaths(groups);

  it('chooses the longest matching path prefix of the link, ignoring the query', () => {
    expect(destinationFor({ type: 'lead.assigned', link: '/company/sales/handovers/9?tab=x' }, paths)).toBe(
      '/company/sales/handovers',
    );
    expect(destinationFor({ type: 'x.y', link: '/company/sales/unknown' }, paths)).toBe('/company/sales');
  });

  it('does not match a path that merely shares leading characters', () => {
    expect(destinationFor({ type: 'x.y', link: '/company/tasksforce' }, paths)).toBeNull();
  });

  it('falls back to the type hint, preferring a more specific prefix', () => {
    expect(destinationFor({ type: 'leave.requested', link: null }, paths)).toBe('/company/leave/queue');
    expect(destinationFor({ type: 'leave.decided', link: null }, paths)).toBe('/company/leave/my');
  });

  it('returns null when the owning entry is not visible to this user', () => {
    expect(destinationFor({ type: 'payroll.payslip_published', link: null }, paths)).toBeNull();
  });
});

describe('computeSidebarBadges', () => {
  it('counts unread only, rolls up to parent and group, and de-duplicates shared paths', () => {
    const badges = computeSidebarBadges({
      groups,
      notifications: [
        note({ type: 'task.assigned', link: '/company/tasks' }),
        note({ type: 'task.updated', link: '/company/tasks', read: true }),
        note({ type: 'lead.assigned', link: '/company/sales/callbacks' }),
        note({ type: 'lead.reassigned', link: '/company/sales/handovers' }),
      ],
    });
    expect(badges.byPath.get('/company/tasks')?.count).toBe(1);
    expect(badges.byParent.get('/company/sales/callbacks')?.count).toBe(2);
    expect(badges.byGroup.get('Sales')?.count).toBe(2);
    expect(badges.byGroup.get('Overview')?.count).toBe(1);
    expect(badges.byGroup.has('Shifts & Leave')).toBe(false);
  });

  it('marks a badge as needing attention when any unread item is operational', () => {
    const badges = computeSidebarBadges({
      groups,
      notifications: [
        note({ type: 'leave.requested', link: '/company/leave/queue', priority: 'operational' }),
        note({ type: 'leave.decided', link: '/company/leave/my' }),
      ],
    });
    expect(badges.byPath.get('/company/leave/queue')?.tone).toBe('attention');
    expect(badges.byPath.get('/company/leave/my')?.tone).toBe('info');
    expect(badges.byGroup.get('Shifts & Leave')).toEqual({ count: 2, tone: 'attention' });
  });

  it('leaves chat to its own live counter instead of double counting', () => {
    const badges = computeSidebarBadges({
      groups,
      notifications: [note({ type: 'chat.message', link: '/company/messages?c=1' })],
      extraCounts: { '/company/messages': 4, '/company/not-in-menu': 9 },
    });
    expect(badges.byPath.get('/company/messages')?.count).toBe(4);
    expect(badges.byPath.has('/company/not-in-menu')).toBe(false);
  });
});

describe('formatBadgeCount', () => {
  it('caps at 99+', () => {
    expect(formatBadgeCount(7)).toBe('7');
    expect(formatBadgeCount(100)).toBe('99+');
  });
});
