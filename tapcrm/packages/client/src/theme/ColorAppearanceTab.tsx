import { useTheme, ACCENT_COLORS, type AccentColor } from './ThemeContext.js';

interface ColorAppearanceTabProps {
  showModeToggle?: boolean;
  className?: string;
  variant?: 'sidebar' | 'page';
}

export function ColorAppearanceTab({
  showModeToggle = true,
  className = '',
  variant = 'sidebar',
}: ColorAppearanceTabProps): React.JSX.Element {
  const { accent, setAccent, resolvedTheme, setTheme } = useTheme();
  const nextTheme = resolvedTheme === 'dark' ? 'light' : 'dark';
  const isDark = resolvedTheme === 'dark';
  const isSidebar = variant === 'sidebar';

  return (
    <div className={`flex items-center justify-between gap-2.5 rounded-2xl border p-2.5 shadow-2xs ${isSidebar ? 'border-sidebar-border bg-sidebar-muted/5 dark:bg-white/[0.045] dark:border-white/10' : 'border-app-border bg-app-surface-raised/50'} ${className}`}>
      {/* Colour Appearance Tab */}
      <div className="flex items-center gap-2">
        <span className={`text-xs font-semibold ${isSidebar ? 'text-sidebar-muted dark:text-white/70' : 'text-app-muted'}`}>Theme</span>
        <div
          role="tablist"
          aria-label="Color appearance themes"
          className={`flex items-center gap-1.5 rounded-full border p-1 shadow-2xs backdrop-blur-xs ${isSidebar ? 'border-sidebar-border bg-sidebar-background/60 dark:border-white/10 dark:bg-black/10' : 'border-app-border bg-app-surface'}`}
        >
          {ACCENT_COLORS.map(({ id, label, hex }) => {
            const isSelected = accent === id;
            return (
              <button
                key={id}
                role="tab"
                type="button"
                aria-selected={isSelected}
                aria-label={`${label} theme`}
                title={`${label} theme`}
                onClick={() => setAccent(id)}
                className={`relative size-6 rounded-full ring-1 ring-inset ring-black/10 transition-all duration-200 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent dark:ring-white/20 ${
                  isSelected
                    ? `ring-2 ring-offset-2 scale-110 shadow-md ${isSidebar ? 'ring-sidebar-foreground ring-offset-sidebar-background dark:ring-white' : 'ring-app-accent ring-offset-app-surface'}`
                    : 'opacity-70 hover:opacity-100 hover:scale-105'
                }`}
                style={{ backgroundColor: hex }}
              >
                {isSelected && (
                  <span className="absolute inset-0 m-auto size-1.5 rounded-full bg-white shadow-xs" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Day / Night mode pill toggle - shown on sidebar on responsive window (< md), hidden on PC desktop */}
      {showModeToggle && (
        <button
          type="button"
          onClick={() => setTheme(nextTheme)}
          aria-label={`Switch to ${nextTheme} mode`}
          title={`Switch to ${nextTheme} mode`}
          className={`inline-flex md:hidden items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors shadow-2xs cursor-pointer shrink-0 ${isSidebar ? 'border-sidebar-border bg-sidebar-muted/10 text-sidebar-foreground hover:bg-sidebar-muted/20' : 'border-app-border bg-app-surface text-app-foreground hover:border-app-accent'}`}
        >
          {isDark ? (
            <>
              <svg className="size-3.5 text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
              </svg>
              <span>Dark</span>
            </>
          ) : (
            <>
              <svg className="size-3.5 text-app-accent dark:text-amber-200" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M21 12.8A8.5 8.5 0 1 1 11.2 3 6.7 6.7 0 0 0 21 12.8Z" />
              </svg>
              <span>Light</span>
            </>
          )}
        </button>
      )}
    </div>
  );
}
