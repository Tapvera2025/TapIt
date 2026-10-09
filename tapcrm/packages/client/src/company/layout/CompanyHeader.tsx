import { Icon } from '../../ui/Icon.js';
import { NotificationBell } from '../../notifications/NotificationBell.js';
import { ThemeToggle } from '../../theme/ThemeToggle.js';
import { AiPetButton } from './AiPet.js';

export function CompanyHeader({
  title,
  onMenu,
  onNavigate,
  pathname,
}: {
  title: string;
  onMenu: () => void;
  onNavigate: (path: string) => void;
  pathname: string;
}): React.JSX.Element {
  return (
    <header className="company-header ui-card mx-3 mt-3 flex shrink-0 items-center justify-between gap-2 px-3 py-2.5 sm:mx-4 sm:mt-4 sm:gap-3 sm:px-4 sm:py-3 md:mx-8 md:mt-5 md:px-5">
      <div className="flex min-w-0 items-center gap-2 sm:gap-3">
        <button
          type="button"
          onClick={onMenu}
          className="company-header-control rounded-xl border border-app-border p-2 md:hidden"
          aria-label="Open navigation"
        >
          <Icon name="menu" />
        </button>
        <div className="flex min-w-0 items-center gap-2 sm:gap-2.5">
          <span className="company-header-workspace-icon hidden size-8 shrink-0 place-items-center rounded-xl sm:grid" aria-hidden="true">
            <Icon name="building" className="size-4" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-[9px] font-bold uppercase tracking-[.15em] text-app-muted sm:text-[10px]">
              Company workspace
            </p>
            <p className="truncate text-[13px] font-semibold sm:text-sm" title={title}>{title}</p>
          </div>
        </div>
      </div>
      <div className="company-header-actions flex shrink-0 items-center gap-1.5 sm:gap-2.5 md:gap-3">
        <NotificationBell onNavigate={onNavigate} className="company-header-action-button" />
        <AiPetButton className="company-header-action-button" />
        <ThemeToggle compact className="inline-flex" />
        <button
          type="button"
          onClick={() => onNavigate('/company/settings')}
          className={`company-header-settings-control company-header-action-button company-header-control rounded-xl border border-app-border p-2.5 text-app-muted hover:text-app-accent ${pathname === '/company/settings' ? 'company-header-control-active' : ''}`}
          aria-label="Settings"
          title="Settings"
          aria-current={pathname === '/company/settings' ? 'page' : undefined}
        >
          <Icon name="settings" />
        </button>
      </div>
    </header>
  );
}
