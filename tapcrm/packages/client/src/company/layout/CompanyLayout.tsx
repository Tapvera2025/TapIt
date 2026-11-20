import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Lenis from 'lenis';
import { PortalSidebar } from '../../layout/PortalSidebar.js';
import { Navbar } from './Navbar.js';
import { ChatUnreadProvider } from '../../chat/ChatUnreadContext.js';
import { NotificationsProvider } from '../../notifications/NotificationsContext.js';
import { applyPermissionsChanged } from '../api/client.js';
import { SalesGuideFrame, SalesGuideToggle } from '../sales/guide/SalesGuide.js';
import { salesGuideKey } from '../sales/guide/page-guidance.js';
import type { CompanySearchDestination, ScreenCapability } from './navigation.js';
import { CompanyNavbarProvider } from './CompanyNavbarContext.js';
import { CompanyPageHero, defaultCompanyPageMetadata } from './CompanyPageHero.js';
import { usePortalSidebarState } from './usePortalSidebarState.js';

export function CompanyLayout({
  pathname,
  identity,
  organizationName,
  organizationCode,
  accountType,
  capabilities,
  canViewChat,
  hasInterviews,
  enabledModules,
  title: _title,
  onNavigate,
  onLogout,
  children,
  searchDestinations,
}: {
  pathname: string;
  identity: {
    fullName: string;
    email: string;
    accountType?: string;
    departmentCode?: string | null;
    departmentName?: string | null;
    positionCode?: string | null;
    positionName?: string | null;
  };
  organizationName: string | null;
  organizationCode: string | null;
  accountType: string;
  /** The powers the server resolved for this session; the sidebar is derived from them. */
  capabilities: readonly ScreenCapability[];
  /** Turns on the unread-message counter. */
  canViewChat: boolean;
  /** Modules enabled for the company; omitted means every module is offered. */
  enabledModules?: readonly string[];
  /** This user has interviews (rounds or panels): show "My Interviews". */
  hasInterviews: boolean;
  title: string;
  onNavigate: (path: string) => void;
  onLogout: () => void;
  children: React.ReactNode;
  searchDestinations: readonly CompanySearchDestination[];
}): React.JSX.Element {
  const {
    sidebarOpen,
    sidebarPinned,
    sidebarExpanded,
    sidebarCollapsed,
    sidebarWidth,
    setSidebarWidth,
    toggleSidebar,
    closeSidebar,
    onSidebarPointerEnter,
    onSidebarPointerLeave,
    onSidebarInteraction,
  } = usePortalSidebarState();
  const mainScrollRef = useRef<HTMLElement>(null);
  const scrollContentRef = useRef<HTMLDivElement>(null);
  const lenisRef = useRef<Lenis | null>(null);
  const contentNeedsViewportHeight =
    pathname === '/company/messages' || /^\/company\/projects\/[^/]+$/.test(pathname);

  useEffect(() => {
    const main = mainScrollRef.current;
    const content = scrollContentRef.current;
    if (!main || !content) return;

    const desktopMotion = window.matchMedia(
      '(min-width: 1280px) and (prefers-reduced-motion: no-preference)',
    );
    const syncScrollMode = () => {
      lenisRef.current?.destroy();
      lenisRef.current = desktopMotion.matches
        ? new Lenis({
            wrapper: main,
            // Keep content separate from the scroll wrapper so Lenis observes
            // page-height changes as routed views and async data render.
            content,
            duration: 1.15,
            smoothWheel: true,
            syncTouch: false,
            wheelMultiplier: 0.9,
            autoRaf: true,
            // Keep nested native scrollers (chat threads, lists, textareas,
            // popovers) native. Only smooth the page itself, not its children.
            prevent: (node) => {
              if (node.closest('dialog[open], [data-lenis-prevent]')) return true;
              let element: HTMLElement | null = node;
              while (element && element !== main) {
                const style = window.getComputedStyle(element);
                const scrollsY =
                  /(auto|scroll)/.test(style.overflowY) &&
                  element.scrollHeight > element.clientHeight + 1;
                const scrollsX =
                  /(auto|scroll)/.test(style.overflowX) &&
                  element.scrollWidth > element.clientWidth + 1;
                if (scrollsY || scrollsX) return true;
                element = element.parentElement;
              }
              return false;
            },
          })
        : null;
    };

    syncScrollMode();
    desktopMotion.addEventListener('change', syncScrollMode);
    return () => {
      desktopMotion.removeEventListener('change', syncScrollMode);
      lenisRef.current?.destroy();
      lenisRef.current = null;
    };
  }, []);

  useLayoutEffect(() => {
    const main = mainScrollRef.current;
    if (!main) return;

    // Layouts persist between SPA routes, so explicitly start each page at its
    // top instead of inheriting the previous route's scroll position.
    main.scrollTop = 0;
    const lenis = lenisRef.current;
    if (lenis) {
      lenis.resize();
      lenis.scrollTo(0, { immediate: true });
    }
  }, [pathname]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeSidebar();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    if (!sidebarOpen || window.innerWidth >= 1280) return;

    const main = mainScrollRef.current;
    const previousBodyOverflow = document.body.style.overflow;
    const previousMainOverflowY = main?.style.overflowY ?? '';
    const previousMainOverscrollBehavior = main?.style.overscrollBehavior ?? '';

    // The page scrolls inside <main>, not on the document. Lock both layers
    // while the mobile drawer is open so the dimmed content cannot move under
    // the fixed navbar or shift its position during a swipe.
    document.body.style.overflow = 'hidden';
    if (main) {
      main.style.overflowY = 'hidden';
      main.style.overscrollBehavior = 'none';
    }

    return () => {
      document.body.style.overflow = previousBodyOverflow;
      if (main) {
        main.style.overflowY = previousMainOverflowY;
        main.style.overscrollBehavior = previousMainOverscrollBehavior;
      }
    };
  }, [sidebarOpen]);

  const initialPage = useMemo(() => defaultCompanyPageMetadata({
    pathname,
    title: _title,
    fullName: identity.fullName,
    isSuperAdmin: accountType === 'super-admin',
  }), [pathname, _title, identity.fullName, accountType]);

  return (
    <ChatUnreadProvider enabled={canViewChat}>
      <NotificationsProvider onPermissionsChanged={applyPermissionsChanged}>
      <CompanyNavbarProvider initialPage={initialPage}>
        <div className="company-layout-shell flex h-dvh flex-col overflow-hidden bg-app-background text-app-foreground">
        <a
          href="#main-content"
          className="fixed left-4 top-4 z-50 -translate-y-24 rounded-lg bg-app-surface p-3 focus:translate-y-0"
        >
          Skip to content
        </a>
        <button
          type="button"
          onClick={closeSidebar}
          className={`mobile-sidebar-backdrop fixed inset-x-0 bottom-0 top-16 z-[55] appearance-none border-0 outline-none bg-black/50 backdrop-blur-[3px] transition-opacity duration-300 ease-out focus:outline-none focus-visible:outline-none focus:ring-0 active:outline-none active:ring-0 xl:hidden ${sidebarOpen ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'}`}
          aria-label="Close navigation overlay"
          aria-hidden={!sidebarOpen}
          tabIndex={sidebarOpen ? 0 : -1}
        />
        <Navbar
          identity={identity}
          organizationName={organizationName}
          organizationCode={organizationCode}
          sidebarCollapsed={!sidebarExpanded}
          sidebarOpen={sidebarOpen}
          onToggleSidebar={toggleSidebar}
          onNavigate={onNavigate}
          onLogout={onLogout}
          searchDestinations={searchDestinations}
          extraActions={salesGuideKey(pathname) !== null ? <SalesGuideToggle /> : null}
        />
        <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
          <PortalSidebar
            pathname={pathname}
            identity={identity}
            organizationName={organizationName}
            accountType={accountType}
            capabilities={capabilities}
            hasInterviews={hasInterviews}
            {...(enabledModules ? { enabledModules } : {})}
            onNavigate={onNavigate}
            onLogout={onLogout}
            open={sidebarOpen}
          onClose={closeSidebar}
            collapsed={sidebarOpen ? false : !sidebarExpanded}
            onToggleCollapsed={toggleSidebar}
            isPinned={sidebarPinned}
            onSidebarPointerEnter={onSidebarPointerEnter}
            onSidebarPointerLeave={onSidebarPointerLeave}
            onSidebarInteraction={onSidebarInteraction}
            width={sidebarWidth}
            onResize={setSidebarWidth}
          />
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <main
              ref={mainScrollRef}
              id="main-content"
              data-app-scroll-container
              className={`min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto ${
                pathname === '/company/attendance/my' ? 'overscroll-contain' : ''
              }`}
              onScroll={(event) => {
                const element = event.currentTarget;
                const maxScroll = element.scrollHeight - element.clientHeight;
                const progress = maxScroll > 0 ? element.scrollTop / maxScroll : 0.45;

                element
                  .closest<HTMLElement>('.company-layout-shell')
                  ?.style.setProperty(
                    '--shell-reflection-position',
                    `${Math.round(progress * 100)}%`,
                  );
              }}
            >
              <div
                ref={scrollContentRef}
                className={
                  contentNeedsViewportHeight ? 'h-full min-h-full' : 'min-h-full'
                }
              >
                <SalesGuideFrame pathname={pathname} onNavigate={onNavigate}>
                  <CompanyPageHero pathname={pathname} onNavigate={onNavigate} />
                  {children}
                </SalesGuideFrame>
              </div>
            </main>
          </div>
        </div>
        </div>
      </CompanyNavbarProvider>
      </NotificationsProvider>
    </ChatUnreadProvider>
  );
}
