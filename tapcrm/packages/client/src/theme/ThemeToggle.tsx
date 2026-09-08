import { useTheme } from './ThemeContext.js';

export function ThemeToggle({ floating = false }: { floating?: boolean }) {
  const { resolvedTheme, setTheme } = useTheme();
  const nextTheme = resolvedTheme === 'dark' ? 'light' : 'dark';
  const isDark = resolvedTheme === 'dark';

  return (
    <button
      type="button"
      className={`group inline-flex items-center gap-2 rounded-full border px-3.5 py-2 text-xs font-semibold transition duration-200 hover:-translate-y-px focus-visible:outline-2 focus-visible:outline-app-accent focus-visible:outline-offset-2 ${floating ? 'fixed bottom-6 right-6 z-20 border-app-border/80 bg-app-surface/95 text-app-foreground shadow-[0_12px_35px_rgba(0,0,0,0.22)] backdrop-blur-md max-[560px]:bottom-4 max-[560px]:right-4' : 'border-app-border bg-app-surface text-app-foreground hover:border-app-accent hover:text-app-accent'}`}
      onClick={() => setTheme(nextTheme)}
      aria-label={`Switch to ${nextTheme} mode`}
      title={`Switch to ${nextTheme} mode`}
    >
      <span className="grid size-6 place-items-center rounded-full bg-app-accent/10 text-app-accent transition group-hover:bg-app-accent group-hover:text-app-background">
        {isDark ? (
          <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
          </svg>
        ) : (
          <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M21 12.8A8.5 8.5 0 1 1 11.2 3 6.7 6.7 0 0 0 21 12.8Z" />
          </svg>
        )}
      </span>
      <span>{isDark ? 'Light mode' : 'Dark mode'}</span>
    </button>
  );
}
