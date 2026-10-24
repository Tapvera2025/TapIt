import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type Theme = 'light' | 'dark' | 'system';
export type AccentColor = 'green' | 'violet' | 'orange' | 'blue';

export const ACCENT_COLORS: { id: AccentColor; label: string; hex: string }[] = [
  { id: 'green', label: 'Green', hex: '#10b981' },
  { id: 'violet', label: 'Violet', hex: '#8b5cf6' },
  { id: 'orange', label: 'Orange', hex: '#f97316' },
  { id: 'blue', label: 'Blue', hex: '#3b82f6' },
];

interface ThemeContextValue {
  theme: Theme;
  resolvedTheme: 'light' | 'dark';
  setTheme: (theme: Theme) => void;
  accent: AccentColor;
  setAccent: (accent: AccentColor) => void;
}

const THEME_STORAGE_KEY = 'tapcrm.theme';
const THEME_MIGRATION_KEY = 'tapcrm.theme-system-default-v1';
const ACCENT_STORAGE_KEY = 'tapcrm.accent';
const VALID_ACCENTS: AccentColor[] = ['green', 'violet', 'orange', 'blue'];

const ThemeContext = createContext<ThemeContextValue | null>(null);

function systemTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function initialTheme(): Theme {
  if (typeof window === 'undefined') return 'system';
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (stored === 'system') return 'system';

  // Older versions only had a manual light/dark toggle. Treat those legacy
  // values as the old default and opt into system sync once after upgrading.
  if (window.localStorage.getItem(THEME_MIGRATION_KEY) !== '1') {
    window.localStorage.setItem(THEME_MIGRATION_KEY, '1');
    window.localStorage.setItem(THEME_STORAGE_KEY, 'system');
    return 'system';
  }

  if (stored === 'light' || stored === 'dark') return stored;
  return 'system';
}

function initialAccent(): AccentColor {
  if (typeof window === 'undefined') return 'green';
  const stored = window.localStorage.getItem(ACCENT_STORAGE_KEY) as AccentColor | null;
  if (stored && VALID_ACCENTS.includes(stored)) return stored;
  return 'green';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [systemResolvedTheme, setSystemResolvedTheme] = useState<'light' | 'dark'>(systemTheme);
  const [accent, setAccentState] = useState<AccentColor>(initialAccent);

  const resolvedTheme = theme === 'system' ? systemResolvedTheme : theme;

  const setAccent = (newAccent: AccentColor) => {
    setAccentState(newAccent);
    window.localStorage.setItem(ACCENT_STORAGE_KEY, newAccent);
    document.documentElement.setAttribute('data-accent', newAccent);
  };

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', resolvedTheme === 'dark');
    root.style.colorScheme = resolvedTheme;
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [resolvedTheme, theme]);

  useEffect(() => {
    document.documentElement.setAttribute('data-accent', accent);
  }, [accent]);

  useEffect(() => {
    if (theme !== 'system') return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    setSystemResolvedTheme(media.matches ? 'dark' : 'light');
    const handleChange = (event: MediaQueryListEvent) => {
      setSystemResolvedTheme(event.matches ? 'dark' : 'light');
    };
    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', handleChange);
      return () => media.removeEventListener('change', handleChange);
    }

    // Safari versions before MediaQueryList.addEventListener use this API.
    media.addListener(handleChange);
    return () => media.removeListener(handleChange);
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme, accent, setAccent }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used inside ThemeProvider');
  return context;
}
