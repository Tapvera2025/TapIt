import { ColorAppearanceTab } from '../../theme/ColorAppearanceTab.js';
import { ThemeToggle } from '../../theme/ThemeToggle.js';
import { Card, Page } from '../../ui/components.js';

export function SettingsPage(): React.JSX.Element {
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
              Switch between the light and dark workspace appearance.
            </p>
          </div>
          <ThemeToggle className="mt-5" />
        </Card>
      </div>
    </Page>
  );
}
