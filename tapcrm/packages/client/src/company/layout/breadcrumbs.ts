import type { CompanyNavGroup } from './navigation.js';

export interface Crumb {
  readonly label: string;
  /** Present when the crumb is a page the user can go to. */
  readonly path?: string;
  readonly current?: boolean;
  readonly icon?: 'home';
}

interface Match {
  readonly group: CompanyNavGroup;
  readonly item: CompanyNavGroup['items'][number];
  readonly child: { readonly label: string; readonly path: string } | null;
  readonly path: string;
}

const owns = (entryPath: string, pathname: string): boolean =>
  pathname === entryPath || pathname.startsWith(`${entryPath}/`);

/** The menu entry (or sub-entry) holding the longest path that owns `pathname`. */
function bestMatch(groups: readonly CompanyNavGroup[], pathname: string): Match | null {
  let best: Match | null = null;
  const consider = (candidate: Match): void => {
    if (!owns(candidate.path, pathname)) return;
    if (!best || candidate.path.length > best.path.length) best = candidate;
  };
  for (const group of groups) {
    for (const item of group.items) {
      consider({ group, item, child: null, path: item.path });
      for (const child of item.children ?? []) {
        consider({ group, item, child, path: child.path });
      }
    }
  }
  return best;
}

/**
 * The breadcrumb for a page, derived from the same menu the sidebar renders, so
 * the two can never disagree about where a page lives:
 *
 *   Home > Group > Entry > Sub-entry > (this page, for routes deeper than the menu)
 *
 * The group is plain text (a section, not a page). `showGroup` is off for the
 * small fixed menus (platform, client) that have no meaningful groups.
 */
export function breadcrumbTrail({
  groups,
  pathname,
  pageTitle,
  homePath,
  showGroup = true,
}: {
  groups: readonly CompanyNavGroup[];
  pathname: string;
  /** The page's own title, used for routes deeper than the menu (a record's detail page). */
  pageTitle?: string | undefined;
  homePath: string;
  showGroup?: boolean;
}): Crumb[] {
  const crumbs: Crumb[] = [];
  if (pathname !== homePath) crumbs.push({ label: 'Home', path: homePath, icon: 'home' });

  const match = bestMatch(groups, pathname);
  if (match) {
    if (showGroup && match.group.label !== match.item.label) crumbs.push({ label: match.group.label });
    crumbs.push({ label: match.item.label, path: match.item.path });
    if (match.child && match.child.label !== match.item.label) {
      crumbs.push({ label: match.child.label, path: match.child.path });
    }
    const last = crumbs[crumbs.length - 1]!;
    if (pathname !== match.path && pageTitle && pageTitle !== last.label) {
      crumbs.push({ label: pageTitle });
    }
  } else if (pageTitle) {
    crumbs.push({ label: pageTitle });
  }

  // The last crumb is where the user is: it is not a link.
  const lastIndex = crumbs.length - 1;
  return crumbs.map((crumb, index) =>
    index === lastIndex ? { label: crumb.label, current: true, ...(crumb.icon ? { icon: crumb.icon } : {}) } : crumb,
  );
}
