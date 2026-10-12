import { useEffect, useRef, useState } from 'react';
import { NotificationBell } from '../../notifications/NotificationBell.js';
import { ThemeToggle } from '../../theme/ThemeToggle.js';
import { BrandLogo } from '../../ui/BrandLogo.js';
import { Icon } from '../../ui/Icon.js';
import { AiPetButton } from './AiPet.js';

function initials(fullName: string): string {
  const value = fullName
    .trim()
    .split(/\s+/)
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return value || 'U';
}

export function Navbar({
  identity,
  organizationName,
  sidebarCollapsed,
  sidebarOpen,
  onToggleSidebar,
  onNavigate,
  onLogout,
}: {
  identity: { fullName: string; email: string; accountType?: string };
  organizationName: string | null;
  sidebarCollapsed: boolean;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  onNavigate: (path: string) => void;
  onLogout: () => void;
}): React.JSX.Element {
  const [accountOpen, setAccountOpen] = useState(false);
  const accountRef = useRef<HTMLDivElement>(null);
  const role = organizationName ? organizationName.slice(0, 3).toUpperCase() : 'ABP';

  useEffect(() => {
    if (!accountOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (accountRef.current && !accountRef.current.contains(event.target as Node)) {
        setAccountOpen(false);
      }
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

  const navigateFromMenu = (path: string) => {
    setAccountOpen(false);
    onNavigate(path);
  };

  return (
    <header className="global-navbar sticky top-0 z-[70] h-16 shrink-0 border-b border-app-border bg-app-surface/95 backdrop-blur-xl">
      <div className="flex h-full min-w-0 items-center gap-2 px-2 sm:gap-3 sm:px-5">
        <div className="flex min-w-0 shrink items-center gap-1.5 sm:gap-2.5">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onToggleSidebar();
            }}
            className="navbar-action-button inline-flex size-9 shrink-0 items-center justify-center rounded-xl border border-app-border bg-app-surface-raised text-app-muted transition hover:border-app-accent/50 hover:bg-app-accent/10 hover:text-app-accent focus-visible:outline-2 focus-visible:outline-app-accent focus-visible:outline-offset-2"
            aria-label={sidebarOpen || !sidebarCollapsed ? 'Collapse sidebar' : 'Expand sidebar'}
            aria-expanded={sidebarOpen || !sidebarCollapsed}
            title={sidebarOpen || !sidebarCollapsed ? 'Collapse sidebar' : 'Expand sidebar'}
          >
            <Icon name="menu" className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => onNavigate('/company/dashboard')}
            className="-ml-1 inline-flex h-9 shrink-0 items-center rounded-lg px-0 focus-visible:outline-2 focus-visible:outline-app-accent focus-visible:outline-offset-2 sm:ml-0 sm:px-1"
            aria-label="Go to dashboard"
            title="Dashboard"
          >
            <BrandLogo className="navbar-brand" />
          </button>
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-2">
          <NotificationBell onNavigate={onNavigate} />
          <ThemeToggle compact className="global-navbar-theme-toggle" />
          <div ref={accountRef} className="relative">
            <button
              type="button"
              onClick={() => setAccountOpen((open) => !open)}
              className="flex h-9 items-center gap-2 rounded-xl border border-app-border bg-app-surface-raised px-1.5 pr-2 text-left transition hover:border-app-accent/50 hover:bg-app-accent/10 focus-visible:outline-2 focus-visible:outline-app-accent focus-visible:outline-offset-2 sm:pr-2.5"
              aria-label="Open account menu"
              aria-haspopup="menu"
              aria-expanded={accountOpen}
            >
              <span className="grid size-6 shrink-0 place-items-center rounded-lg bg-app-accent/15 text-[10px] font-bold text-app-accent ring-1 ring-inset ring-app-accent/20">
                {initials(identity.fullName)}
              </span>
              <span className="hidden min-w-0 lg:block">
                <span className="block max-w-28 truncate text-xs font-semibold text-app-foreground">{identity.fullName}</span>
                <span className="block text-[9px] font-bold uppercase tracking-[0.12em] text-app-muted">{role}</span>
              </span>
              <Icon name="chevron-down" className="hidden size-3 text-app-muted lg:block" />
            </button>
            {accountOpen && (
              <div className="absolute right-0 top-full z-50 mt-2 w-60 overflow-hidden rounded-xl border border-app-border bg-app-surface p-1.5 shadow-lg" role="menu">
                <div className="border-b border-app-border px-3 py-2.5">
                  <p className="truncate text-sm font-semibold text-app-foreground">{identity.fullName}</p>
                  <p className="truncate text-xs text-app-muted">{identity.email}</p>
                </div>
                <div className="flex items-center justify-between gap-3 px-3 py-2.5">
                  <span className="text-xs font-semibold text-app-muted">AI companion</span>
                  <AiPetButton className="navbar-account-pet size-8 !p-0" />
                </div>
                <button type="button" role="menuitem" onClick={() => navigateFromMenu('/company/settings')} className="mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-app-muted hover:bg-app-surface-raised hover:text-app-foreground">
                  <Icon name="settings" className="size-4" /> Settings
                </button>
                <button type="button" role="menuitem" onClick={onLogout} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-app-danger hover:bg-app-danger/10">
                  <Icon name="logout" className="size-4" /> Log out
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
