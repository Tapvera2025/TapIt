import { useEffect, useRef, useState, type ReactNode } from 'react';
import { NotificationBell } from '../../notifications/NotificationBell.js';
import { BrandLogo } from '../../ui/index.js';
import { Icon } from '../../ui/index.js';
import { AiPetButton } from './AiPet.js';
import { GlobalFeatureSearch } from './GlobalFeatureSearch.js';
import type { CompanySearchDestination } from './navigation.js';

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
  organizationName: _organizationName,
  organizationCode: _organizationCode,
  sidebarCollapsed,
  sidebarOpen,
  onToggleSidebar,
  onNavigate,
  onLogout,
  searchDestinations,
  settingsPath = '/company/settings',
  extraActions = null,
}: {
  identity: {
    fullName: string;
    email: string;
    accountType?: string;
    positionCode?: string | null;
    positionName?: string | null;
  };
  organizationName: string | null;
  organizationCode: string | null;
  sidebarCollapsed: boolean;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  onNavigate: (path: string) => void;
  onLogout: () => void;
  searchDestinations: readonly CompanySearchDestination[];
  settingsPath?: string;
  /** Page-specific buttons shown before the notification bell (e.g. the sales guide toggle). */
  extraActions?: ReactNode;
}): React.JSX.Element {
  const [accountOpen, setAccountOpen] = useState(false);
  const accountRef = useRef<HTMLDivElement>(null);
  const designation = identity.accountType === 'super-admin'
    ? 'Super Admin'
    : identity.positionName || identity.positionCode || 'Employee';
  const sidebarExpanded = window.innerWidth < 1280 ? sidebarOpen : !sidebarCollapsed;

  useEffect(() => {
    if (!accountOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if ((event.target as Element | null)?.closest('[data-ai-pet-picker]')) return;
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
    <header className="global-navbar sticky top-0 z-[70] h-16 shrink-0 border-b border-app-border bg-app-surface/95 backdrop-blur-xl xl:top-4 xl:mx-5 xl:mt-4 xl:rounded-2xl xl:border">
      <div className="flex h-full min-w-0 items-center gap-2 px-3 sm:gap-3 sm:px-5">
        <div className="flex min-w-0 shrink items-center gap-1 sm:gap-2 lg:gap-1">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onToggleSidebar();
            }}
            className="navbar-action-button inline-flex size-9 shrink-0 items-center justify-center rounded-xl border border-app-border bg-app-surface-raised text-app-muted transition hover:border-app-accent/50 hover:bg-app-accent/10 hover:text-app-accent focus-visible:outline-2 focus-visible:outline-app-accent focus-visible:outline-offset-2 xl:hidden"
            aria-label={sidebarExpanded ? 'Collapse sidebar' : 'Expand sidebar'}
            aria-expanded={sidebarExpanded}
            title={sidebarExpanded ? 'Collapse sidebar' : 'Expand sidebar'}
          >
            <Icon
              name={sidebarExpanded ? 'close' : 'menu'}
              className={`size-4 transition-transform duration-300 ease-in-out motion-reduce:transition-none ${sidebarExpanded ? 'rotate-180' : 'rotate-0'}`}
            />
          </button>
          <span
            className="navbar-brand-mark -ml-1 lg:-ml-1.5 inline-flex h-9 shrink-0 items-center px-0"
            aria-label="Tapvera CRM"
          >
            <BrandLogo className="navbar-brand" />
          </span>
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-2.5 max-[420px]:gap-2">
          <GlobalFeatureSearch
            destinations={searchDestinations}
            onNavigate={onNavigate}
          />
          {extraActions}
          <NotificationBell onNavigate={onNavigate} />
          <div ref={accountRef} className="relative">
            <button
              type="button"
              onClick={() => setAccountOpen((open) => !open)}
              className="flex size-10 items-center justify-center rounded-full border border-app-border bg-app-surface-raised p-0 text-left transition hover:border-app-accent/50 hover:bg-app-accent/10 focus-visible:outline-2 focus-visible:outline-app-accent focus-visible:outline-offset-2"
              aria-label="Open account menu"
              aria-haspopup="menu"
              aria-expanded={accountOpen}
            >
              <span className="text-xs font-bold text-app-accent">
                {initials(identity.fullName)}
              </span>
            </button>
            {accountOpen && (
              <div
                className="absolute right-0 top-full z-50 mt-2 w-72 max-w-[calc(100vw-1rem)] overflow-hidden rounded-xl border border-app-border bg-app-surface p-1.5 shadow-lg"
                role="menu"
              >
                <div className="border-b border-app-border px-3 py-2.5">
                  <div className="flex min-w-0 items-baseline gap-2.5">
                    <p className="min-w-0 flex-1 truncate text-sm font-semibold text-app-foreground">
                      {identity.fullName}
                    </p>
                    <span className="max-w-[45%] shrink-0 truncate border-l border-app-border pl-2.5 text-[11px] font-medium text-app-muted" title={designation}>
                      {designation}
                    </span>
                  </div>
                  <p className="truncate text-xs text-app-muted">{identity.email}</p>
                </div>
                <div className="flex items-center justify-between gap-3 px-3 py-2.5">
                  <span className="text-xs font-semibold text-app-muted">
                    AI companion
                  </span>
                  <AiPetButton
                    wrapperClassName="navbar-account-pet"
                    className="size-8 !p-0"
                  />
                </div>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => navigateFromMenu(settingsPath)}
                  className="mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-app-muted hover:bg-app-surface-raised hover:text-app-foreground"
                >
                  <Icon name="settings" className="size-4" /> Settings
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={onLogout}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-app-danger hover:bg-app-danger/10"
                >
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
