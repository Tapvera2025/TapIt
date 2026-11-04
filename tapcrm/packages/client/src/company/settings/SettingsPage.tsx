import { ColorAppearanceTab } from '../../theme/ColorAppearanceTab.js';
import { useTheme, type Theme } from '../../theme/ThemeContext.js';
import { Card, Page } from '../../ui/components.js';
import { organizationApi } from '../../organization/api/organizationApi.js';
import { useEffect, useState } from 'react';

const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD', 'AUD', 'CAD'];
export function SettingsPage({ showCurrencyManagement = false }: { showCurrencyManagement?: boolean }): React.JSX.Element {
  const { theme, setTheme } = useTheme();
  const [supportedCurrencies, setSupportedCurrencies] = useState<string[]>(['INR']);
  const [defaultCurrency, setDefaultCurrency] = useState('INR');
  const [currencyMessage, setCurrencyMessage] = useState('');
  useEffect(() => { if (showCurrencyManagement) void organizationApi.currencySettings().then((s) => { setSupportedCurrencies(s.supportedCurrencies); setDefaultCurrency(s.defaultCurrency); }).catch(() => undefined); }, [showCurrencyManagement]);
  async function saveCurrencies(): Promise<void> {
    setCurrencyMessage('');
    try { const saved = await organizationApi.updateCurrencySettings({ supportedCurrencies, defaultCurrency }); setSupportedCurrencies(saved.supportedCurrencies); setDefaultCurrency(saved.defaultCurrency); setCurrencyMessage('Currency settings saved.'); } catch (e) { setCurrencyMessage(e instanceof Error ? e.message : 'Unable to save currency settings.'); }
  }
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
        {showCurrencyManagement && <Card>
          <div><h2 className="font-display text-xl font-bold">Currency management</h2><p className="mt-1 text-sm text-app-muted">Choose the currencies available for employee advances and set the default.</p></div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {CURRENCIES.map((code) => <label key={code} className="flex items-center gap-2 rounded-xl border border-app-border p-3 text-sm font-semibold"><input type="checkbox" checked={supportedCurrencies.includes(code)} onChange={(e) => { const next = e.target.checked ? [...supportedCurrencies, code] : supportedCurrencies.filter((x) => x !== code); if (code === defaultCurrency && !e.target.checked) setDefaultCurrency(next[0] ?? 'INR'); setSupportedCurrencies(next); }} />{code}</label>)}
          </div>
          <label className="mt-4 block text-sm font-semibold">Default currency<select className="mt-2 w-full rounded-lg border border-app-border bg-app-background px-3 py-2.5" value={defaultCurrency} onChange={(e) => setDefaultCurrency(e.target.value)}>{supportedCurrencies.map((code) => <option key={code}>{code}</option>)}</select></label>
          <div className="mt-4 flex items-center gap-3"><button type="button" className="rounded-lg bg-app-accent px-4 py-2 text-sm font-semibold text-white" onClick={() => void saveCurrencies()}>Save currencies</button>{currencyMessage && <span className="text-sm text-app-muted">{currencyMessage}</span>}</div>
        </Card>}
      </div>
    </Page>
  );
}
