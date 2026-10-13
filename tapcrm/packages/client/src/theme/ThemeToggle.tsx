import { useState } from 'react';
import { useTheme } from './ThemeContext.js';
import { Icon } from '../ui/Icon.js';

export function ThemeToggle({
  floating = false,
  compact = false,
  showChevron = false,
  onActivate,
  className = '',
}: {
  floating?: boolean;
  compact?: boolean;
  showChevron?: boolean;
  onActivate?: () => void;
  className?: string;
}) {
  const { resolvedTheme, setTheme } = useTheme();
  const [isChanging, setIsChanging] = useState(false);
  const nextTheme = resolvedTheme === 'dark' ? 'light' : 'dark';
  const isDark = resolvedTheme === 'dark';

  return (
    <button
      type="button"
      className={`${compact ? 'navbar-action-button theme-toggle-navbar inline-flex size-9 items-center justify-center gap-1 rounded-xl border border-app-border bg-app-surface/70 p-0 text-app-muted' : 'theme-toggle-liquid group inline-flex items-center gap-2 rounded-full border p-1.5 pr-3 text-xs font-semibold shadow-sm max-sm:size-9 max-sm:justify-center max-sm:p-0'} transition duration-200 hover:-translate-y-px hover:shadow-md focus-visible:outline-2 focus-visible:outline-app-accent focus-visible:outline-offset-2 ${isChanging ? 'theme-toggle-liquid-changing' : ''} ${
        floating
          ? 'fixed bottom-6 right-6 z-20 border-app-border/80 bg-app-surface/95 text-app-foreground shadow-[0_12px_35px_rgba(0,0,0,0.22)] backdrop-blur-md max-[560px]:bottom-4 max-[560px]:right-4'
          : !compact ? 'border-app-border/80 bg-app-surface/80 text-app-foreground hover:border-app-accent/60 hover:bg-app-surface' : ''
      } ${className}`}
      onClick={() => {
        setIsChanging(true);
        setTheme(nextTheme);
        onActivate?.();
        window.setTimeout(() => setIsChanging(false), 420);
      }}
      aria-label={`Switch to ${nextTheme} mode`}
      title={`Switch to ${nextTheme} mode`}
      data-tooltip={compact ? `Switch to ${nextTheme} mode` : undefined}
      aria-pressed={isDark}
    >
      <span className="theme-toggle-liquid-sheen" aria-hidden="true" />
      <span className="grid size-7 place-items-center rounded-full bg-app-accent/12 text-app-accent ring-1 ring-inset ring-app-accent/15 transition group-hover:bg-app-accent group-hover:text-app-background">
        {isDark ? (
          <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
          </svg>
        ) : (
          <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 12.8A8.5 8.5 0 1 1 11.2 3 6.7 6.7 0 0 0 21 12.8Z" />
          </svg>
        )}
      </span>
      {compact && showChevron && <Icon name="chevron-down" className="size-3" />}
      {!compact && (
        <span className={floating ? 'hidden text-left sm:inline' : 'hidden text-left lg:inline'}>
          <span className="block text-[9px] font-medium uppercase leading-none tracking-[0.14em] text-app-muted">Appearance</span>
          <span className="mt-1 block leading-none">{isDark ? 'Dark' : 'Light'}</span>
        </span>
      )}
    </button>
  );
}
