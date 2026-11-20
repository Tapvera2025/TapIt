import { useEffect, useRef, useState, type ReactNode } from 'react';
import { NotificationBell } from '../../notifications/NotificationBell.js';
import { BrandLogo } from '../../ui/index.js';
import { Icon } from '../../ui/index.js';
import { AiPetButton } from './AiPet.js';
import { GlobalFeatureSearch } from './GlobalFeatureSearch.js';
import type { CompanySearchDestination } from './navigation.js';
import { createPortal } from 'react-dom';
import { useCompanyHeroUtility } from './CompanyNavbarContext.js';
import { ThemeToggle } from '../../theme/ThemeToggle.js';
import { ProfileCompletionRing } from '../profile/ProfileCompletionRing.js';
import { completionPercent, useMyProfile } from '../profile/myProfileStore.js';

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
  showSearch = true,
  showNotifications = true,
  showAccountDesignation = true,
  showAiCompanion = true,
  showSettings = true,
  showLogout = true,
  profilePreview = false,
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
  /** Portal-level controls for reduced navigation surfaces such as Master Admin. */
  showSearch?: boolean;
  showNotifications?: boolean;
  showAccountDesignation?: boolean;
  showAiCompanion?: boolean;
  /** Optional account-menu actions for portals with a reduced profile menu. */
  showSettings?: boolean;
  showLogout?: boolean;
  /** Master Admin uses a compact hover preview instead of a full account menu. */
  profilePreview?: boolean;
}): React.JSX.Element {
  const [accountOpen, setAccountOpen] = useState(false);
  const [desktop, setDesktop] = useState(() => window.matchMedia('(min-width: 1280px)').matches);
  const { target, setTarget } = useCompanyHeroUtility();
  const inlineControls = !desktop || !setTarget;
  const accountRef = useRef<HTMLDivElement>(null);
  const profileHoverTimer = useRef<number | null>(null);
  const designation = identity.accountType === 'super-admin'
    ? 'Super Admin'
    : identity.accountType === 'client'
      ? 'Client'
    : identity.positionName || identity.positionCode || 'Employee';
  const sidebarExpanded = window.innerWidth < 1280 ? sidebarOpen : !sidebarCollapsed;
  // Employees complete their own profile after HR creates the account; the
  // avatar shows how far along they are until it is done.
  const isEmployee = identity.accountType === 'employee';
  const { profile } = useMyProfile(isEmployee);
  const profilePercent = completionPercent(profile);
  const profileIncomplete = profilePercent !== null && profilePercent < 100;

  useEffect(() => {
    const media = window.matchMedia('(min-width: 1280px)');
    const update = () => setDesktop(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

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

  const openProfilePreview = () => {
    if (!profilePreview || !desktop) return;
    if (profileHoverTimer.current !== null) window.clearTimeout(profileHoverTimer.current);
    setAccountOpen(true);
  };

  const closeProfilePreview = () => {
    if (!profilePreview || !desktop) return;
    if (profileHoverTimer.current !== null) window.clearTimeout(profileHoverTimer.current);
    profileHoverTimer.current = window.setTimeout(() => setAccountOpen(false), 120);
  };

  const controls = (
        <div className="navbar-utility-controls ml-auto flex shrink-0 items-center gap-2.5 max-[420px]:gap-2">
          {showSearch && (
            <GlobalFeatureSearch className="company-hero-search" destinations={searchDestinations} onNavigate={onNavigate} />
          )}
          {desktop && <ThemeToggle compact className="company-hero-capsule-theme-toggle" />}
          {extraActions}
          {showNotifications && <NotificationBell onNavigate={onNavigate} />}
          <div
            ref={accountRef}
            className="relative"
            onMouseEnter={profilePreview ? openProfilePreview : undefined}
            onMouseLeave={profilePreview ? closeProfilePreview : undefined}
          >
            {profileIncomplete ? (
              <button type="button" onClick={() => setAccountOpen((open) => !open)} className="grid size-10 place-items-center rounded-full p-0 transition focus-visible:outline-2 focus-visible:outline-app-accent focus-visible:outline-offset-2" aria-label={`Open account menu. Profile ${profilePercent}% complete`} title={`Profile ${profilePercent}% complete`} aria-haspopup="menu" aria-expanded={accountOpen}>
                <ProfileCompletionRing percent={profilePercent}>
                  <span className="grid size-[32px] place-items-center rounded-full bg-app-surface-raised text-xs font-bold text-app-accent">{initials(identity.fullName)}</span>
                </ProfileCompletionRing>
              </button>
            ) : (
              <button type="button" onClick={() => setAccountOpen((open) => !open)} onContextMenu={(event) => { if (profilePreview) event.preventDefault(); }} className="flex size-10 select-none touch-manipulation items-center justify-center rounded-full border border-app-border bg-app-surface-raised p-0 text-left transition hover:border-app-accent/50 hover:bg-app-accent/10 focus-visible:outline-2 focus-visible:outline-app-accent focus-visible:outline-offset-2" aria-label="Open account menu" aria-haspopup="menu" aria-expanded={accountOpen}>
                <span className="select-none text-xs font-bold text-app-accent">{initials(identity.fullName)}</span>
              </button>
            )}
            {accountOpen && (
              <div className={`absolute right-0 top-full z-[1000] max-w-[calc(100vw-1rem)] select-none overflow-hidden border border-app-border bg-app-surface shadow-lg ${profilePreview ? 'mt-3 w-56 rounded-xl p-3 shadow-[0_12px_28px_rgba(15,23,42,0.14)]' : 'mt-2 w-72 rounded-xl p-1.5'}`} role={profilePreview ? 'tooltip' : 'menu'}>
                <div className={profilePreview ? 'px-1 py-0.5' : 'border-b border-app-border px-3 py-2.5'}>
                  <div className="flex min-w-0 items-baseline gap-2.5">
                    <p className="min-w-0 flex-1 truncate text-sm font-semibold text-app-foreground">{identity.fullName}</p>
                    {showAccountDesignation && (
                      <span className="max-w-[45%] shrink-0 truncate border-l border-app-border pl-2.5 text-[11px] font-medium text-app-muted" title={designation}>{designation}</span>
                    )}
                  </div>
                  <p className="truncate text-xs text-app-muted">{identity.email}</p>
                </div>
                {showAiCompanion && (
                  <div className="flex items-center justify-between gap-3 px-3 py-2.5">
                    <span className="text-xs font-semibold text-app-muted">AI companion</span>
                    <AiPetButton wrapperClassName="navbar-account-pet" className="size-8 !p-0" />
                  </div>
                )}
                {profilePercent !== null && (
                  <button type="button" role="menuitem" onClick={() => navigateFromMenu('/company/my-profile')} className="mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-app-muted hover:bg-app-surface-raised hover:text-app-foreground">
                    <Icon name="clipboard" className="size-4" />
                    <span className="flex-1">My profile</span>
                    {profileIncomplete ? (
                      <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[11px] font-bold text-amber-700 dark:text-amber-300">{profilePercent}% complete</span>
                    ) : (
                      <span className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">Complete</span>
                    )}
                  </button>
                )}
                {showSettings && (
                  <button type="button" role="menuitem" onClick={() => navigateFromMenu(settingsPath)} className="mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-app-muted hover:bg-app-surface-raised hover:text-app-foreground"><Icon name="settings" className="size-4" /> Settings</button>
                )}
                {showLogout && (
                  <button type="button" role="menuitem" onClick={onLogout} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-app-danger hover:bg-app-danger/10"><Icon name="logout" className="size-4" /> Log out</button>
                )}
              </div>
            )}
          </div>
        </div>
  );

  return (
    <>
    {desktop && target && createPortal(controls, target)}
    <header className={`global-navbar sticky top-0 z-[70] h-16 shrink-0 border-b border-app-border bg-app-surface/95 backdrop-blur-xl ${setTarget ? 'xl:hidden' : ''}`}>
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

        {inlineControls && controls}
        {/* The same controls move into the desktop hero without a second state owner. */}
      </div>
    </header>
    </>
  );
}
