import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { CompanySidebar } from '../company/layout/CompanySidebar.js';
import { Navbar } from '../company/layout/Navbar.js';
import { SettingsPage } from '../company/settings/SettingsPage.js';
import { isNotAClientError } from './api/portalApi.js';
import { listClientProjectDiscussions } from './api/projectDiscussionApi.js';
import { CLIENT_CHAT_UNREAD_CHANGED_EVENT } from './useClientMessages.js';
import { ClientDashboardPage } from './pages/ClientDashboardPage.js';
import { ClientProfilePage } from './pages/ClientProfilePage.js';
import { ClientProjectPage } from './pages/ClientProjectPage.js';
import { ClientProjectsPage } from './pages/ClientProjectsPage.js';
import { ClientMessagesPage } from './pages/ClientMessagesPage.js';
import { ClientMeetingsPage } from './pages/ClientMeetingsPage.js';
import { identityApiBasePath, getIdentityAccessToken } from '../identity/api/authApi.js';
import type { CompanySearchDestination } from '../company/layout/navigation.js';

const clientSearchDestinations: readonly CompanySearchDestination[] = [
  {
    label: 'Dashboard',
    path: '/client',
    icon: 'grid',
    category: 'Client Portal',
    keywords: ['client', 'home', 'overview'],
  },
  {
    label: 'Projects',
    path: '/client/projects',
    icon: 'grid',
    category: 'Client Portal',
    keywords: ['project', 'delivery'],
  },
  {
    label: 'Messages',
    path: '/client/messages',
    icon: 'message',
    category: 'Client Portal',
    keywords: ['chat', 'communication'],
  },
  {
    label: 'Meetings',
    path: '/client/meetings',
    icon: 'calendar',
    category: 'Client Portal',
    keywords: ['meeting', 'call', 'google meet', 'appointment', 'book'],
  },
  {
    label: 'Profile',
    path: '/client/profile',
    icon: 'users',
    category: 'Client Portal',
    keywords: ['account', 'user'],
  },
  {
    label: 'Settings',
    path: '/client/settings',
    icon: 'settings',
    category: 'Preferences',
    keywords: ['settings', 'appearance', 'theme'],
  },
];

/** Client-only navigation rendered in the same global app shell as workspace pages. */
export function ClientWorkspace({
  pathname,
  onNavigate,
  onLogout,
}: {
  pathname: string;
  onNavigate: (path: string) => void;
  onLogout: () => void;
}): React.JSX.Element {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(256);
  const [clientMessagesUnread, setClientMessagesUnread] = useState(0);
  const mainScrollRef = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    if (mainScrollRef.current) mainScrollRef.current.scrollTop = 0;
  }, [pathname]);

  // An employee who lands here with a valid token is sent to their own workspace.
  const handleError = useCallback(
    (cause: unknown) => {
      if (isNotAClientError(cause)) onNavigate('/company/dashboard');
    },
    [onNavigate],
  );

  useEffect(() => {
    let live = true;
    const refreshUnread = () => {
      void listClientProjectDiscussions()
        .then((result) => {
          if (live)
            setClientMessagesUnread(
              result.discussions.reduce(
                (sum, item) => sum + item.conversation.unreadCount,
                0,
              ),
            );
        })
        .catch(() => undefined);
    };
    refreshUnread();
    const socket = io({
      path: `${identityApiBasePath()}/socket.io`,
      auth: (send) => send({ token: getIdentityAccessToken() ?? '' }),
      reconnectionDelayMax: 30_000,
    });
    for (const event of [
      'chat:message:new',
      'chat:message:read',
      'chat:message:unsent',
      'chat:conversation:new',
      'chat:conversation:updated',
    ])
      socket.on(event, refreshUnread);
    const onUnreadChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ unread: number }>).detail;
      if (typeof detail?.unread === 'number') setClientMessagesUnread(detail.unread);
    };
    const poll = window.setInterval(() => {
      if (!socket.connected) refreshUnread();
    }, 60_000);
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
  if (projectMatch)
    page = (
      <ClientProjectPage
        key={projectMatch[1]}
        id={decodeURIComponent(projectMatch[1]!)}
        onNavigate={onNavigate}
        onError={handleError}
      />
    );
  else if (pathname === '/client/messages') page = <ClientMessagesPage />;
  else if (pathname === '/client/meetings')
    page = <ClientMeetingsPage initialProjectId={new URLSearchParams(window.location.search).get('project')} onError={handleError} />;
  else if (pathname === '/client/projects')
    page = <ClientProjectsPage onNavigate={onNavigate} onError={handleError} />;
  else if (pathname === '/client/profile')
    page = <ClientProfilePage onError={handleError} />;
  else if (pathname === '/client/settings') page = <SettingsPage />;
  else page = <ClientDashboardPage onNavigate={onNavigate} onError={handleError} />;

  const toggleSidebar = () => {
    if (window.matchMedia('(min-width: 1280px)').matches)
      setSidebarCollapsed((collapsed) => !collapsed);
    else setSidebarOpen((open) => !open);
  };

  return (
    <div className="company-layout-shell flex h-dvh flex-col overflow-hidden bg-app-background text-app-foreground">
      <a
        href="#main-content"
        className="fixed left-4 top-4 z-[100] -translate-y-24 rounded-lg bg-app-surface p-3 focus:translate-y-0"
      >
        Skip to content
      </a>
      <button
        type="button"
        onClick={() => setSidebarOpen(false)}
        className={`mobile-sidebar-backdrop fixed inset-x-0 bottom-0 top-16 z-[55] bg-black/50 backdrop-blur-[3px] transition-opacity duration-300 ease-out xl:hidden ${sidebarOpen ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'}`}
        aria-label="Close navigation overlay"
        aria-hidden={!sidebarOpen}
        tabIndex={sidebarOpen ? 0 : -1}
      />
      <Navbar
        identity={{ fullName: 'Client workspace', email: '', accountType: 'client' }}
        organizationName={null}
        organizationCode={null}
        sidebarCollapsed={sidebarCollapsed}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={toggleSidebar}
        onNavigate={onNavigate}
        onLogout={onLogout}
        searchDestinations={clientSearchDestinations}
        settingsPath="/client/settings"
      />

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

        <main
          ref={mainScrollRef}
          id="main-content"
          data-app-scroll-container
          className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto"
        >
          {page}
        </main>
      </div>
    </div>
  );
}
