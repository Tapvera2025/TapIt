import { ThemeToggle } from '../../theme/ThemeToggle.js';
import { Icon } from '../../ui/Icon.js';
import { NotificationBell } from '../../notifications/NotificationBell.js';

export function CompanyHeader({
  title,
  onMenu,
  onLogout,
  onNavigate,
}: {
  title: string;
  onMenu: () => void;
  onLogout: () => void;
  onNavigate: (path: string) => void;
}): React.JSX.Element {
  return (
    <header className="ui-card mx-4 mt-4 flex shrink-0 items-center justify-between gap-3 px-4 py-3 md:mx-8 md:mt-5 md:px-5">
      <div className="flex min-w-0 items-center gap-3">
        <button
          type="button"
          onClick={onMenu}
          className="rounded-lg border border-app-border p-2 md:hidden"
          aria-label="Open navigation"
        >
          <Icon name="menu" />
        </button>
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[.14em] text-app-muted">
            Company workspace
          </p>
          <p className="truncate text-sm font-semibold">{title}</p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <NotificationBell onNavigate={onNavigate} />
        <ThemeToggle />
        <button
          type="button"
          onClick={onLogout}
          className="rounded-lg border border-app-border p-2.5 text-app-muted hover:text-app-accent"
          aria-label="Log out"
          title="Log out"
        >
          <Icon name="logout" />
        </button>
      </div>
    </header>
  );
}
