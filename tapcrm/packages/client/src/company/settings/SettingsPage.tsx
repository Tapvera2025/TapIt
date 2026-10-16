import { ColorAppearanceTab } from '../../theme/ColorAppearanceTab.js';
import { useTheme, type Theme } from '../../theme/ThemeContext.js';
import { Card, Page } from '../../ui/components.js';

export function SettingsPage(): React.JSX.Element {
  const { theme, setTheme } = useTheme();
  const modes: { id: Theme; label: string; description: string }[] = [
    { id: 'system', label: 'System', description: 'Follow your device' },
    { id: 'light', label: 'Light', description: 'Always use light mode' },
    { id: 'dark', label: 'Dark', description: 'Always use dark mode' },
  ];

  return (
    <Page
      eyebrow="Preferences"
      title="Settings"
      description="Manage the appearance of your TapCRM workspace."
    >
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <div>
            <h2 className="font-display text-xl font-bold">Color appearance</h2>
            <p className="mt-1 text-sm text-app-muted">
              Choose the accent palette used across the workspace.
            </p>
          </div>
          <ColorAppearanceTab variant="page" showModeToggle={false} className="mt-5" />
        </Card>

        <Card>
          <div>
            <h2 className="font-display text-xl font-bold">Display mode</h2>
            <p className="mt-1 text-sm text-app-muted">
              Follow your device appearance automatically or choose a mode.
            </p>
          </div>
          <div className="mt-5 grid gap-2 sm:grid-cols-3" role="group" aria-label="Display mode">
            {modes.map(({ id, label, description }) => (
              <button
                key={id}
                type="button"
                onClick={() => setTheme(id)}
                aria-pressed={theme === id}
                className={`rounded-xl border p-3 text-left transition focus-visible:outline-2 focus-visible:outline-app-accent ${theme === id ? 'border-app-accent bg-app-accent/10 text-app-foreground ring-1 ring-inset ring-app-accent/25' : 'border-app-border bg-app-background/35 text-app-foreground hover:border-app-accent/35'}`}
              >
                <span className="block text-sm font-semibold">{label}</span>
                <span className="mt-1 block text-xs text-app-muted">{description}</span>
              </button>
            ))}
          </div>
        </Card>
      </div>
    </Page>
  );
}
