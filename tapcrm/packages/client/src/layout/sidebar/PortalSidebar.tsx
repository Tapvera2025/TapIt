import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../../ui/index.js';
import { SidebarPet, useAiPet } from '../../company/layout/AiPet.js';
import { useChatUnread } from '../../chat/ChatUnreadContext.js';
import { useRegisterNavigation } from '../../company/layout/CompanyNavbarContext.js';
import { useOptionalNotificationsFeed } from '../../notifications/NotificationsContext.js';
import type { CompanyNavGroup, CompanyNavItem } from '../../company/layout/navigation.js';
import {
  buildSidebarNavigation,
  type SidebarNavigationInput,
  type SidebarVariant,
} from '../../company/layout/sidebarNavigation.js';
import {
  computeSidebarBadges,
  formatBadgeCount,
  type NavBadge,
} from '../../company/layout/sidebarBadges.js';
import './sidebar.css';

const GROUP_ICONS: Record<string, string> = {
  Platform: 'grid',
  Overview: 'grid',
  Communication: 'message',
  Organization: 'building',
  'Employee Activities': 'users',
  Recruitment: 'user-plus',
  Delivery: 'briefcase',
  'SEO Intelligence': 'chart',
  Sales: 'dollar-sign',
  Attendance: 'clock',
  'Shifts & Leave': 'calendar',
  'Advances & Penalties': 'alert-circle',
  Payroll: 'wallet',
  Finance: 'calculator',
  'Identity & Access': 'shield',
  Preferences: 'settings',
  Account: 'users',
};

/** The entry that opens a route in each portal (matched exactly, never by prefix). */
const ROOT_ROUTE: Record<SidebarVariant, string> = {
  company: '/company/organization',
  client: '/client',
  platform: '/platform',
};

export interface PortalSidebarProps
  extends Omit<SidebarNavigationInput, 'variant' | 'accountType' | 'enabledModules'> {
  variant?: SidebarVariant;
  pathname: string;
  /** Kept for the callers that already pass the signed-in person; the menu does not use it. */
  identity?: {
    fullName: string;
    email: string;
    accountType?: string;
    departmentCode?: string | null;
    departmentName?: string | null;
    positionCode?: string | null;
    positionName?: string | null;
  };
  organizationName: string | null;
  accountType: string;
  /** Modules enabled for the company; omitted means every module is offered. */
  enabledModules?: readonly string[];
  /** The client portal keeps its own message counter. */
  clientMessagesUnread?: number;
  onNavigate: (path: string) => void;
  onLogout: () => void;
  open: boolean;
  onClose: () => void;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  isPinned?: boolean;
  onSidebarPointerEnter?: (event: React.PointerEvent<HTMLElement>) => void;
  onSidebarPointerLeave?: (event: React.PointerEvent<HTMLElement>) => void;
  onSidebarInteraction?: () => void;
  width?: number;
  onResize?: (width: number) => void;
  showAiPet?: boolean;
}

interface GroupState {
  hasActiveNested: boolean;
  hasExact: boolean;
  /** Paths already marked current in this group: two entries may share a page, only the first lights up. */
  claimed: Set<string>;
}

const isActivePath = (pathname: string, path: string, isRoot: boolean): boolean =>
  pathname === path || (!isRoot && pathname.startsWith(`${path}/`));

/** The group that owns the current route: the one holding the longest matching path. */
function groupForPath(groups: readonly CompanyNavGroup[], pathname: string): string | null {
  let best: { label: string; length: number } | null = null;
  for (const group of groups) {
    for (const item of group.items) {
      for (const path of [item.path, ...(item.children ?? []).map((child) => child.path)]) {
        if ((pathname === path || pathname.startsWith(`${path}/`)) && (!best || path.length > best.length)) {
          best = { label: group.label, length: path.length };
        }
      }
    }
  }
  return best?.label ?? groups[0]?.label ?? null;
}

function Chip({ badge, noun = 'unread' }: { badge: NavBadge; noun?: string }): React.JSX.Element {
  return (
    <span className="ps-chip" data-tone={badge.tone}>
      <span aria-hidden="true">{formatBadgeCount(badge.count)}</span>
      <span className="sr-only">{`${badge.count} ${noun}`}</span>
    </span>
  );
}

export function PortalSidebar({
  variant = 'company',
  pathname,
  organizationName,
  accountType,
  enabledModules,
  clientMessagesUnread = 0,
  onNavigate,
  onLogout,
  open,
  onClose,
  collapsed = false,
  onToggleCollapsed,
  isPinned = false,
  onSidebarPointerEnter,
  onSidebarPointerLeave,
  onSidebarInteraction,
  width = 256,
  onResize,
  showAiPet = true,
  identity: _identity,
  ...navigationFlags
}: PortalSidebarProps): React.JSX.Element {
  void _identity;
  const { activePet } = useAiPet();
  const { total: unreadMessages } = useChatUnread();
  const notifications = useOptionalNotificationsFeed()?.items;

  const groups = useMemo(
    () => buildSidebarNavigation({ ...navigationFlags, variant, accountType, enabledModules }),
    // The flags object is rebuilt on every render; its values are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [variant, accountType, enabledModules, ...Object.values(navigationFlags)],
  );

  useRegisterNavigation(groups);

  const badges = useMemo(
    () =>
      computeSidebarBadges({
        groups,
        notifications: notifications ?? [],
        extraCounts:
          variant === 'client'
            ? { '/client/messages': clientMessagesUnread }
            : { '/company/messages': unreadMessages },
      }),
    [groups, notifications, variant, clientMessagesUnread, unreadMessages],
  );

  const [openSection, setOpenSection] = useState<string | null>(() =>
    collapsed ? null : groupForPath(groups, pathname),
  );
  const [collapsedItems, setCollapsedItems] = useState<Record<string, boolean>>({});

  // Follow the route: a destination opens the group that owns it.
  const previousPathname = useRef(pathname);
  useEffect(() => {
    if (previousPathname.current !== pathname && !collapsed) {
      setOpenSection(groupForPath(groups, pathname));
    }
    previousPathname.current = pathname;
  }, [pathname, collapsed, groups]);

  // Expanding the rail (hover or pin) opens the section holding the current page.
  const wasCollapsed = useRef(collapsed);
  useEffect(() => {
    if (wasCollapsed.current && !collapsed) {
      setOpenSection((current) => current ?? groupForPath(groups, pathname));
    }
    wasCollapsed.current = collapsed;
  }, [collapsed, groups, pathname]);

  // The scroller keeps its place across navigation and resets whenever the
  // sidebar closes or collapses, so it always reopens at the top.
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollTopRef = useRef(0);
  useLayoutEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollTopRef.current;
  }, [pathname]);
  useEffect(() => {
    if ((collapsed || !open) && scrollRef.current) {
      scrollRef.current.scrollTop = 0;
      scrollTopRef.current = 0;
    }
  }, [collapsed, open]);

  const resizeStart = useRef<{ x: number; width: number } | null>(null);
  const [isResizing, setIsResizing] = useState(false);
  const clampWidth = (next: number) => Math.min(420, Math.max(220, next));
  const startResize = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (collapsed || !onResize) return;
    event.preventDefault();
    resizeStart.current = { x: event.clientX, width };
    event.currentTarget.setPointerCapture(event.pointerId);
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
    setIsResizing(true);
  };
  const moveResize = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!resizeStart.current || !onResize) return;
    onResize(clampWidth(resizeStart.current.width + event.clientX - resizeStart.current.x));
  };
  const stopResize = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    resizeStart.current = null;
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
    setIsResizing(false);
  };
  const resizeWithKeyboard = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!onResize || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
    event.preventDefault();
    onResize(clampWidth(width + (event.key === 'ArrowRight' ? 16 : -16)));
  };

  const workspaceLabel =
    variant === 'client'
      ? organizationName || 'Client Portal'
      : variant === 'platform'
        ? 'Master Admin'
        : organizationName || 'Company';
  const workspaceName =
    variant === 'client' ? 'Client Workspace' : variant === 'platform' ? 'Platform Console' : 'Company Workspace';
  const navLabel =
    variant === 'client' ? 'Client navigation' : variant === 'platform' ? 'Platform navigation' : 'Company navigation';
  const rootRoute = ROOT_ROUTE[variant];

  const go = (path: string, groupLabel: string): void => {
    onSidebarInteraction?.();
    setOpenSection(groupLabel);
    onNavigate(path);
    onClose();
  };

  const renderItem = (group: CompanyNavGroup, item: CompanyNavItem, groupState: GroupState): React.JSX.Element => {
    const active = isActivePath(pathname, item.path, item.path === rootRoute);
    const current =
      active &&
      !groupState.hasActiveNested &&
      (!groupState.hasExact || pathname === item.path) &&
      !groupState.claimed.has(item.path);
    if (current) groupState.claimed.add(item.path);
    const hasChildren = Boolean(item.children?.length);
    const childrenShown = hasChildren && (collapsedItems[item.label] ?? false) === false;
    const badge = hasChildren ? (badges.byParent.get(item.path) ?? badges.byPath.get(item.path)) : badges.byPath.get(item.path);
    return (
      <li key={item.path} className="ps-tree-item">
        <button
          type="button"
          data-company-nav-item="true"
          className="ps-item"
          aria-current={current ? 'page' : undefined}
          aria-expanded={hasChildren ? childrenShown : undefined}
          onClick={() => {
            if (hasChildren && pathname.startsWith(item.path)) {
              setCollapsedItems((prev) => ({ ...prev, [item.label]: childrenShown }));
              return;
            }
            if (hasChildren) setCollapsedItems((prev) => ({ ...prev, [item.label]: false }));
            go(item.path, group.label);
          }}
        >
          <span className="ps-item-label" title={item.label}>{item.label}</span>
          {badge && <Chip badge={badge} />}
          {hasChildren && <Icon name="chevron-down" className="ps-item-caret" />}
        </button>
        {hasChildren && childrenShown && (
          <ul className="ps-subtree">
            {item.children!.map((sub) => {
              const subActive = pathname === sub.path && !groupState.claimed.has(sub.path);
              if (subActive) groupState.claimed.add(sub.path);
              const subBadge = badges.byPath.get(sub.path);
              return (
                <li key={sub.path}>
                  <button
                    type="button"
                    className="ps-subitem"
                    aria-current={subActive ? 'page' : undefined}
                    onClick={() => go(sub.path, group.label)}
                  >
                    <span className="ps-item-label">{sub.label}</span>
                    {subBadge && <Chip badge={subBadge} />}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </li>
    );
  };

  /** Small fixed menus (client, platform) are plain icon links, no accordion. */
  const renderFlatItem = (group: CompanyNavGroup, item: CompanyNavItem): React.JSX.Element => {
    const active = isActivePath(pathname, item.path, item.path === rootRoute);
    const badge = badges.byPath.get(item.path);
    return (
      <div key={item.path} className="ps-group">
        <button
          type="button"
          data-company-nav-item="true"
          className="ps-row ps-row-link"
          aria-current={active ? 'page' : undefined}
          title={collapsed ? item.label : undefined}
          onClick={() => go(item.path, group.label)}
        >
          <span className="ps-icon">
            <Icon name={item.icon} className="size-[1.15rem]" />
            {collapsed && badge && <span className="ps-dot" data-tone={badge.tone} />}
          </span>
          <span className="ps-row-label">{item.label}</span>
          {badge && <Chip badge={badge} />}
        </button>
      </div>
    );
  };

  const renderGroup = (group: CompanyNavGroup): React.JSX.Element => {
    const icon = GROUP_ICONS[group.label] ?? 'grid';
    const groupBadge = badges.byGroup.get(group.label);
    const holdsActive = groupForPath(groups, pathname) === group.label;
    const single = group.items.length === 1 && !group.items[0]!.children?.length ? group.items[0]! : null;

    // A group with one entry is just a link: no accordion, like the single rows of the design.
    if (single) {
      const active = isActivePath(pathname, single.path, single.path === rootRoute);
      return (
        <div key={group.label} className="ps-group">
          <button
            type="button"
            data-company-nav-item="true"
            className="ps-row ps-row-link"
            aria-current={active ? 'page' : undefined}
            title={collapsed ? single.label : undefined}
            onClick={() => go(single.path, group.label)}
          >
            <span className="ps-icon">
              <Icon name={icon} className="size-[1.15rem]" />
              {collapsed && groupBadge && <span className="ps-dot" data-tone={groupBadge.tone} />}
            </span>
            <span className="ps-row-label">{single.label}</span>
            {groupBadge && <Chip badge={groupBadge} />}
          </button>
        </div>
      );
    }

    const isOpen = !collapsed && openSection === group.label;
    const state: GroupState = {
      hasActiveNested: group.items.some((item) =>
        item.children?.some((sub) => pathname === sub.path || pathname.startsWith(`${sub.path}/`)),
      ),
      hasExact: group.items.some(
        (item) => pathname === item.path || item.children?.some((sub) => pathname === sub.path),
      ),
      claimed: new Set<string>(),
    };
    const panelId = `ps-panel-${group.label.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`;
    return (
      <div key={group.label} className="ps-group" data-open={isOpen ? 'true' : 'false'}>
        <button
          type="button"
          className="ps-row ps-row-group"
          data-holds-active={holdsActive ? 'true' : 'false'}
          aria-expanded={isOpen}
          aria-controls={panelId}
          title={collapsed ? group.label : undefined}
          onClick={() => {
            onSidebarInteraction?.();
            if (collapsed) return;
            setOpenSection((current) => (current === group.label ? null : group.label));
          }}
        >
          <span className="ps-icon">
            <Icon name={icon} className="size-[1.15rem]" />
            {collapsed && groupBadge && <span className="ps-dot" data-tone={groupBadge.tone} />}
          </span>
          <span className="ps-row-label" title={group.label}>{group.label}</span>
          {/* An open group shows each entry's own count instead of the roll-up. */}
          {!isOpen && groupBadge && <Chip badge={groupBadge} />}
          <Icon name="chevron-down" className="ps-caret" />
        </button>
        {isOpen && (
          <ul id={panelId} className="ps-tree">
            {group.items.map((item) => renderItem(group, item, state))}
          </ul>
        )}
      </div>
    );
  };

  return (
    <aside
      onPointerEnter={onSidebarPointerEnter}
      onPointerLeave={onSidebarPointerLeave}
      className={`workspace-sidebar ps-root relative fixed bottom-0 left-0 top-16 z-[60] flex min-h-0 w-72 flex-none flex-col overflow-x-hidden border-r border-sidebar-border bg-sidebar-bg px-4 py-5 transition-[transform,width,padding] duration-[460ms] ease-[cubic-bezier(0.4,0,0.2,1)] will-change-[transform,width] xl:static xl:my-4 xl:h-[calc(100%-2rem)] xl:translate-x-0 xl:self-start xl:overflow-x-visible xl:rounded-2xl xl:shadow-[0_8px_24px_-24px_rgba(15,23,42,0.6)] ${open ? 'translate-x-0' : '-translate-x-full'} ${collapsed ? 'xl:w-[76px] xl:px-2' : 'sidebar-resizable'} ${showAiPet && activePet ? 'sidebar-has-pet' : ''} ${isResizing ? 'select-none' : ''}`}
      style={collapsed ? undefined : ({ '--company-sidebar-width': `${width}px` } as React.CSSProperties)}
      data-sidebar-collapsed={collapsed ? 'true' : 'false'}
      data-sidebar-open={open ? 'true' : 'false'}
      data-sidebar-pinned={isPinned ? 'true' : 'false'}
    >
      <div className="ps-header">
        <span className="ps-logo" aria-hidden="true">
          {workspaceLabel.trim().charAt(0).toUpperCase() || 'T'}
        </span>
        <span className="ps-header-copy">
          <span className="ps-header-company">{workspaceLabel}</span>
          <span className="ps-header-name">{workspaceName}</span>
        </span>
        {onToggleCollapsed && (
          <button
            type="button"
            onClick={onToggleCollapsed}
            className={`ps-toggle hidden xl:flex ${isPinned ? 'is-pinned' : ''}`}
            aria-label={isPinned ? 'Unpin sidebar' : collapsed ? 'Expand sidebar' : 'Pin sidebar'}
            aria-pressed={isPinned}
            aria-expanded={!collapsed}
            title={isPinned ? 'Unpin sidebar' : collapsed ? 'Expand sidebar' : 'Pin sidebar'}
          >
            <Icon name={isPinned ? 'pushpin' : collapsed ? 'chevron-right' : 'chevron-left'} className="pointer-events-none size-4" />
          </button>
        )}
      </div>
      <div className="sidebar-mobile-workspace-title">
        <p>{workspaceName}</p>
        <button type="button" onClick={onClose} aria-label="Close navigation">
          ×
        </button>
      </div>
      {!collapsed && (
        <button
          type="button"
          className={`sidebar-resize-handle hidden xl:flex ${isResizing ? 'is-resizing' : ''}`}
          onPointerDown={startResize}
          onPointerMove={moveResize}
          onPointerUp={stopResize}
          onPointerCancel={stopResize}
          onKeyDown={resizeWithKeyboard}
          aria-label="Resize sidebar"
          aria-orientation="vertical"
          aria-valuemin={220}
          aria-valuemax={420}
          aria-valuenow={width}
          role="separator"
          title="Drag to resize sidebar"
        >
          <span aria-hidden="true" />
        </button>
      )}
      <div
        ref={scrollRef}
        onScroll={(event) => {
          scrollTopRef.current = event.currentTarget.scrollTop;
        }}
        data-lenis-prevent
        className="ps-scroll"
        role="navigation"
        aria-label={navLabel}
      >
        {/* Laid out at full width and clipped, so opening the rail reveals it instead of re-wrapping text. */}
        <div className="ps-inner">
          {variant === 'company'
            ? groups.map(renderGroup)
            : groups.flatMap((group) => group.items.map((item) => renderFlatItem(group, item)))}
        </div>
      </div>
      {showAiPet && activePet && (
        <div className={`sidebar-pet-runway shrink-0 border-t border-sidebar-border/70 px-1 pt-1 ${collapsed ? 'xl:hidden' : ''}`}>
          <SidebarPet pet={activePet} />
        </div>
      )}
      <div className="ps-footer">
        <button
          type="button"
          onClick={onLogout}
          className={`sidebar-logout ps-logout ${collapsed ? 'xl:justify-center' : ''}`}
          title={collapsed ? 'Log out' : undefined}
        >
          <Icon name="logout" className="size-4" />
          <span className={collapsed ? 'xl:hidden' : ''}>Log out</span>
        </button>
      </div>
    </aside>
  );
}
