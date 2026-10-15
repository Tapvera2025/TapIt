import { useCallback } from 'react';
import { BrandLogo } from '../ui/BrandLogo.js';
import { ThemeToggle } from '../theme/ThemeToggle.js';
import { isNotAClientError } from './api/portalApi.js';
import { PortalLink } from './components.js';
import { ClientDashboardPage } from './pages/ClientDashboardPage.js';
import { ClientProfilePage } from './pages/ClientProfilePage.js';
import { ClientProjectPage } from './pages/ClientProjectPage.js';
import { ClientProjectsPage } from './pages/ClientProjectsPage.js';

const NAV = [
  { href: '/client', label: 'Dashboard' },
  { href: '/client/projects', label: 'Projects' },
  { href: '/client/profile', label: 'Profile' },
] as const;

function isActive(pathname: string, href: string): boolean {
  return href === '/client' ? pathname === '/client' : pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Mobile-first shell for the client portal (PRD CP-6). Deliberately separate
 * from CompanyWorkspace: no sidebar, no employee navigation, no shared state.
 */
export function ClientWorkspace({
  pathname, onNavigate, onLogout,
}: { pathname: string; onNavigate: (path: string) => void; onLogout: () => void }): React.JSX.Element {
  // An employee who lands here with a valid token is sent to their own workspace.
  const handleError = useCallback((cause: unknown) => {
    if (isNotAClientError(cause)) onNavigate('/company/dashboard');
  }, [onNavigate]);

  const projectMatch = /^\/client\/projects\/([^/]+)$/.exec(pathname);
  let page: React.JSX.Element;
  if (projectMatch) page = <ClientProjectPage id={decodeURIComponent(projectMatch[1]!)} onNavigate={onNavigate} onError={handleError} />;
  else if (pathname === '/client/projects') page = <ClientProjectsPage onNavigate={onNavigate} onError={handleError} />;
  else if (pathname === '/client/profile') page = <ClientProfilePage onError={handleError} />;
  else page = <ClientDashboardPage onNavigate={onNavigate} onError={handleError} />;

  return (
    <div className="min-h-dvh bg-app-background text-app-foreground">
      <a href="#main-content" className="fixed left-4 top-4 z-50 -translate-y-24 rounded-lg bg-app-surface p-3 focus:translate-y-0">Skip to content</a>
      <header className="sticky top-0 z-20 border-b border-app-border bg-app-surface/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 md:px-8">
          <PortalLink href="/client" onNavigate={onNavigate}><BrandLogo className="w-[130px]" /></PortalLink>
          <nav aria-label="Client portal" className="order-last -mx-1 flex w-full gap-1 overflow-x-auto md:order-none md:mx-0 md:w-auto">
            {NAV.map((item) => (
              <PortalLink
                key={item.href}
                href={item.href}
                onNavigate={onNavigate}
                className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold transition ${isActive(pathname, item.href) ? 'bg-app-accent/10 text-app-accent' : 'text-app-muted hover:text-app-foreground'}`}
              >
                {item.label}
              </PortalLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
            <button type="button" onClick={onLogout} className="rounded-lg border border-app-border px-3 py-2 text-sm font-semibold hover:border-app-accent">Sign out</button>
          </div>
        </div>
      </header>
      <main id="main-content">{page}</main>
    </div>
  );
}
