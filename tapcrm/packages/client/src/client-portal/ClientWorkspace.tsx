import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { AiPetButton } from '../company/layout/AiPet.js';
import { CompanySidebar } from '../company/layout/CompanySidebar.js';
import { SettingsPage } from '../company/settings/SettingsPage.js';
import { ThemeToggle } from '../theme/ThemeToggle.js';
import { BrandLogo } from '../ui/BrandLogo.js';
import { Icon } from '../ui/Icon.js';
import { isNotAClientError } from './api/portalApi.js';
import { listClientProjectDiscussions } from './api/projectDiscussionApi.js';
import { CLIENT_CHAT_UNREAD_CHANGED_EVENT } from './useClientMessages.js';
import { ClientDashboardPage } from './pages/ClientDashboardPage.js';
import { ClientProfilePage } from './pages/ClientProfilePage.js';
import { ClientProjectPage } from './pages/ClientProjectPage.js';
import { ClientProjectsPage } from './pages/ClientProjectsPage.js';
import { ClientMessagesPage } from './pages/ClientMessagesPage.js';
import { identityApiBasePath, getIdentityAccessToken } from '../identity/api/authApi.js';

/** Client-only navigation rendered in the same global app shell as workspace pages. */
export function ClientWorkspace({
  pathname, onNavigate, onLogout,
}: { pathname: string; onNavigate: (path: string) => void; onLogout: () => void }): React.JSX.Element {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(256);
  const [accountOpen, setAccountOpen] = useState(false);
  const [clientMessagesUnread, setClientMessagesUnread] = useState(0);
  const accountRef = useRef<HTMLDivElement>(null);
  const mainScrollRef = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    if (mainScrollRef.current) mainScrollRef.current.scrollTop = 0;
  }, [pathname]);

  // An employee who lands here with a valid token is sent to their own workspace.
  const handleError = useCallback((cause: unknown) => {
    if (isNotAClientError(cause)) onNavigate('/company/dashboard');
  }, [onNavigate]);

  useEffect(() => {
    let live = true;
    const refreshUnread = () => {
      void listClientProjectDiscussions().then((result) => {
        if (live) setClientMessagesUnread(result.discussions.reduce((sum, item) => sum + item.conversation.unreadCount, 0));
      }).catch(() => undefined);
    };
    refreshUnread();
    const socket = io({ path: `${identityApiBasePath()}/socket.io`, auth: (send) => send({ token: getIdentityAccessToken() ?? '' }), reconnectionDelayMax: 30_000 });
    for (const event of ['chat:message:new', 'chat:message:read', 'chat:message:unsent', 'chat:conversation:new', 'chat:conversation:updated']) socket.on(event, refreshUnread);
    const onUnreadChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ unread: number }>).detail;
      if (typeof detail?.unread === 'number') setClientMessagesUnread(detail.unread);
    };
    const poll = window.setInterval(() => { if (!socket.connected) refreshUnread(); }, 60_000);
    window.addEventListener(CLIENT_CHAT_UNREAD_CHANGED_EVENT, onUnreadChanged);
    return () => {
      live = false;
      window.clearInterval(poll);
      window.removeEventListener(CLIENT_CHAT_UNREAD_CHANGED_EVENT, onUnreadChanged);
      socket.close();
    };
  }, []);

  const projectMatch = /^\/client\/projects\/([^/]+)$/.exec(pathname);
  let page: React.JSX.Element;
  if (projectMatch) page = <ClientProjectPage key={projectMatch[1]} id={decodeURIComponent(projectMatch[1]!)} onNavigate={onNavigate} onError={handleError} />;
  else if (pathname === '/client/messages') page = <ClientMessagesPage />;
  else if (pathname === '/client/projects') page = <ClientProjectsPage onNavigate={onNavigate} onError={handleError} />;
  else if (pathname === '/client/profile') page = <ClientProfilePage onError={handleError} />;
  else if (pathname === '/client/settings') page = <SettingsPage />;
  else page = <ClientDashboardPage onNavigate={onNavigate} onError={handleError} />;

  useEffect(() => {
    if (!accountOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if ((event.target as Element | null)?.closest('[data-ai-pet-picker]')) return;
      if (accountRef.current && !accountRef.current.contains(event.target as Node)) setAccountOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setAccountOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [accountOpen]);

  const toggleSidebar = () => {
    if (window.matchMedia('(min-width: 1280px)').matches) setSidebarCollapsed((collapsed) => !collapsed);
    else setSidebarOpen((open) => !open);
  };

  return (
    <div className="company-layout-shell flex h-dvh flex-col overflow-hidden bg-app-background text-app-foreground">
      <a href="#main-content" className="fixed left-4 top-4 z-[100] -translate-y-24 rounded-lg bg-app-surface p-3 focus:translate-y-0">Skip to content</a>
      <button
        type="button"
        onClick={() => setSidebarOpen(false)}
        className={`mobile-sidebar-backdrop fixed inset-x-0 bottom-0 top-16 z-[55] bg-black/50 backdrop-blur-[3px] transition-opacity duration-300 ease-out xl:hidden ${sidebarOpen ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'}`}
        aria-label="Close navigation overlay"
        aria-hidden={!sidebarOpen}
        tabIndex={sidebarOpen ? 0 : -1}
      />
      <header className="global-navbar sticky top-0 z-[70] h-16 shrink-0 border-b border-app-border bg-app-surface/95 backdrop-blur-xl xl:top-4 xl:mx-5 xl:mt-4 xl:rounded-2xl xl:border">
        <div className="flex h-full min-w-0 items-center gap-2 px-2 sm:gap-3 sm:px-5">
          <div className="flex min-w-0 shrink items-center gap-1 sm:gap-2 lg:gap-1">
          <button
            type="button"
            onClick={toggleSidebar}
            className="navbar-action-button inline-flex size-9 shrink-0 items-center justify-center rounded-xl border border-app-border bg-app-surface-raised text-app-muted transition hover:border-app-accent/50 hover:bg-app-accent/10 hover:text-app-accent focus-visible:outline-2 focus-visible:outline-app-accent focus-visible:outline-offset-2"
            aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Toggle navigation'}
            aria-expanded={sidebarOpen || !sidebarCollapsed}
            title={sidebarCollapsed ? 'Expand sidebar' : 'Toggle navigation'}
          >
            <Icon name={sidebarOpen ? 'close' : 'menu'} className="size-4" />
          </button>
          <a href="/client" onClick={(event) => { event.preventDefault(); onNavigate('/client'); }} className="navbar-brand-mark -ml-1 lg:-ml-1.5 inline-flex h-9 shrink-0 items-center px-0" aria-label="Tapvera CRM client portal">
            <BrandLogo className="navbar-brand" />
          </a>
          </div>

          <div className="ml-auto flex shrink-0 items-center gap-2">
            <ThemeToggle compact className="global-navbar-theme-toggle" />
            <div ref={accountRef} className="relative">
              <button
                type="button"
                onClick={() => setAccountOpen((open) => !open)}
                className="flex h-9 items-center gap-2 rounded-xl border border-app-border bg-app-surface-raised px-1.5 pr-2 text-left transition hover:border-app-accent/50 hover:bg-app-accent/10 focus-visible:outline-2 focus-visible:outline-app-accent focus-visible:outline-offset-2 sm:pr-2.5"
                aria-label="Open client account menu"
                aria-haspopup="menu"
                aria-expanded={accountOpen}
              >
                <span className="grid size-6 shrink-0 place-items-center rounded-lg bg-app-accent/15 text-[10px] font-bold text-app-accent ring-1 ring-inset ring-app-accent/20">C</span>
                <span className="hidden min-w-0 lg:block">
                  <span className="block max-w-32 truncate text-xs font-semibold text-app-foreground">Client workspace</span>
                  <span className="block text-[9px] font-bold uppercase tracking-[0.12em] text-app-muted">Portal</span>
                </span>
                <Icon name="chevron-down" className="hidden size-3 text-app-muted lg:block" />
              </button>
              {accountOpen && (
                <div className="absolute right-0 top-full z-50 mt-2 w-56 overflow-hidden rounded-xl border border-app-border bg-app-surface p-1.5 shadow-lg" role="menu">
                  <p className="border-b border-app-border px-3 py-2.5 text-sm font-semibold text-app-foreground">Client workspace</p>
                  <div className="flex items-center justify-between gap-3 px-3 py-2.5">
                    <span className="text-xs font-semibold text-app-muted">AI companion</span>
                    <AiPetButton wrapperClassName="navbar-account-pet" className="size-8 !p-0" />
                  </div>
                  <button type="button" role="menuitem" onClick={() => { setAccountOpen(false); onNavigate('/client/settings'); }} className="mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-app-muted hover:bg-app-surface-raised hover:text-app-foreground">
                    <Icon name="settings" className="size-4" /> Settings
                  </button>
                  <button type="button" role="menuitem" onClick={() => { setAccountOpen(false); onLogout(); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-app-danger hover:bg-app-danger/10">
                    <Icon name="logout" className="size-4" /> Sign out
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <CompanySidebar
          variant="client"
          clientMessagesUnread={clientMessagesUnread}
          pathname={pathname}
          identity={{ fullName: 'Client', email: '', accountType: 'client' }}
          organizationName={null}
          accountType="client"
          onNavigate={onNavigate}
          onLogout={onLogout}
          open={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          collapsed={sidebarCollapsed}
          onToggleCollapsed={toggleSidebar}
          width={sidebarWidth}
          onResize={setSidebarWidth}
        />

        <main ref={mainScrollRef} id="main-content" data-app-scroll-container className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto">
          {page}
        </main>
      </div>
    </div>
  );
}
