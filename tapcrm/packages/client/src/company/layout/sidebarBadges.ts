import type { AppNotification } from '../../notifications/api/notificationsApi.js';
import type { CompanyNavGroup } from './navigation.js';

/**
 * Sidebar badges: how many unread things belong behind each menu entry.
 *
 * The rule is generic so a new module needs no sidebar change: an unread
 * notification counts toward the menu entry whose path is the longest prefix of
 * the notification's own `link` (every notification already carries the in-app
 * path it opens). Only when a notification has no usable link does the type
 * hint table below choose an entry. Anything that matches no visible entry
 * simply stays in the bell.
 */

/** `attention` = something needs the user (operational); `info` = for awareness. */
export type BadgeTone = 'attention' | 'info';

export interface NavBadge {
  count: number;
  tone: BadgeTone;
}

export interface SidebarBadges {
  /** Count per destination path (a menu entry or one of its sub-entries). */
  byPath: ReadonlyMap<string, NavBadge>;
  /** Roll-up per group label, shown when the group is closed or the rail is collapsed. */
  byGroup: ReadonlyMap<string, NavBadge>;
  /** Roll-up per entry that has sub-entries, keyed by the entry's path. */
  byParent: ReadonlyMap<string, NavBadge>;
}

/**
 * Fallback for notifications without a usable link: type prefix to candidate
 * paths, first visible candidate wins. Order matters (most specific first).
 * Links are the primary mechanism; add a row here only for a type that ships
 * without one.
 */
const TYPE_HINTS: ReadonlyArray<readonly [prefix: string, paths: readonly string[]]> = [
  ['task.', ['/company/tasks']],
  ['leave.requested', ['/company/leave/queue']],
  ['leave.', ['/company/leave/my']],
  ['attendance.correction_requested', ['/company/attendance/corrections']],
  ['attendance.', ['/company/attendance/my']],
  ['breaks.breach_reviewed', ['/company/attendance/today']],
  ['breaks.', ['/company/breaks/queue', '/company/attendance/today']],
  ['payroll.', ['/company/payroll/my-payslips']],
  ['penalty.', ['/company/my-penalties', '/company/penalties']],
  ['expense.claim_submitted', ['/company/expenses/approvals']],
  ['expense.', ['/company/expenses/mine']],
  ['project.', ['/client/projects', '/company/projects']],
  ['meeting.', ['/client/meetings', '/company/meetings']],
  ['recruitment.interview_assigned', ['/company/my-interviews']],
  ['recruitment.', ['/company/recruitment']],
  ['lead.', ['/company/sales/my-work']],
  ['social.', ['/company/social', '/client/social']],
  ['access.', ['/company/access', '/company/role-change-request']],
  ['company.', ['/platform/companies']],
  ['invitation.', ['/platform/invitations']],
];

/** Chat is counted by its own live counter (see `extraCounts`), not by notifications. */
const SELF_COUNTED_TYPE_PREFIXES: readonly string[] = ['chat.'];

function normalise(link: string): string {
  const path = link.split(/[?#]/, 1)[0] ?? '';
  return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
}

/** Every path a user can click: entries and their sub-entries, de-duplicated. */
export function destinationPaths(groups: readonly CompanyNavGroup[]): string[] {
  const seen = new Set<string>();
  for (const group of groups) {
    for (const item of group.items) {
      seen.add(item.path);
      for (const child of item.children ?? []) seen.add(child.path);
    }
  }
  return [...seen];
}

/** The menu path a notification belongs to, or null when no visible entry owns it. */
export function destinationFor(notification: Pick<AppNotification, 'link' | 'type'>, paths: readonly string[]): string | null {
  if (notification.link) {
    const link = normalise(notification.link);
    let best: string | null = null;
    for (const path of paths) {
      if (link === path || link.startsWith(`${path}/`)) {
        if (best === null || path.length > best.length) best = path;
      }
    }
    if (best) return best;
  }
  for (const [prefix, candidates] of TYPE_HINTS) {
    if (!notification.type.startsWith(prefix)) continue;
    const hit = candidates.find((candidate) => paths.includes(candidate));
    if (hit) return hit;
  }
  return null;
}

function add(into: Map<string, NavBadge>, key: string, count: number, tone: BadgeTone): void {
  if (count <= 0) return;
  const current = into.get(key);
  if (!current) {
    into.set(key, { count, tone });
    return;
  }
  into.set(key, { count: current.count + count, tone: current.tone === 'attention' || tone === 'attention' ? 'attention' : 'info' });
}

/** Sum the badges of a set of unique paths. */
function rollUp(paths: Iterable<string>, byPath: ReadonlyMap<string, NavBadge>): NavBadge | null {
  let count = 0;
  let tone: BadgeTone = 'info';
  for (const path of new Set(paths)) {
    const badge = byPath.get(path);
    if (!badge) continue;
    count += badge.count;
    if (badge.tone === 'attention') tone = 'attention';
  }
  return count > 0 ? { count, tone } : null;
}

export function computeSidebarBadges({
  groups,
  notifications,
  extraCounts = {},
}: {
  groups: readonly CompanyNavGroup[];
  notifications: readonly AppNotification[];
  /** Live counters owned elsewhere, keyed by destination path (e.g. unread chat). */
  extraCounts?: Readonly<Record<string, number>>;
}): SidebarBadges {
  const paths = destinationPaths(groups);
  const byPath = new Map<string, NavBadge>();

  for (const notification of notifications) {
    if (notification.read) continue;
    if (SELF_COUNTED_TYPE_PREFIXES.some((prefix) => notification.type.startsWith(prefix))) continue;
    const path = destinationFor(notification, paths);
    if (path) add(byPath, path, 1, notification.priority === 'operational' ? 'attention' : 'info');
  }
  for (const [path, count] of Object.entries(extraCounts)) {
    if (paths.includes(path)) add(byPath, path, count, 'info');
  }

  const byGroup = new Map<string, NavBadge>();
  const byParent = new Map<string, NavBadge>();
  for (const group of groups) {
    const groupPaths: string[] = [];
    for (const item of group.items) {
      const own = [item.path, ...(item.children ?? []).map((child) => child.path)];
      groupPaths.push(...own);
      if (item.children?.length) {
        const parent = rollUp(own, byPath);
        if (parent) byParent.set(item.path, parent);
      }
    }
    const total = rollUp(groupPaths, byPath);
    if (total) byGroup.set(group.label, total);
  }
  return { byPath, byGroup, byParent };
}

/** "99+" cap so a badge never outgrows its chip. */
export function formatBadgeCount(count: number): string {
  return count > 99 ? '99+' : String(count);
}
