import { useEffect, useState } from 'react';
import { Button, Card, Loading, Notice, Select } from '../../ui/components.js';
import { getSearchConsoleSettings, linkSearchConsoleProperty, syncSearchConsoleRanks, unlinkSearchConsoleProperty } from './api/projectReportsApi.js';
import type { SearchConsoleSettings } from './types.js';

/**
 * Linking a project to its Search Console property, and running a fetch now.
 *
 * The copy is deliberate about what Search Console reports — an average
 * position over a window, days behind, Google organic only. A rank tracker it
 * is not, and a user reading "Current" in the table deserves to know which.
 */

const syncTone: Record<string, string> = {
  ok: 'text-emerald-600',
  partial: 'text-amber-600',
  failed: 'text-red-600',
};

export function SearchConsoleCard({ projectId, onSynced }: { projectId: string; onSynced: () => void }): React.JSX.Element {
  const [settings, setSettings] = useState<SearchConsoleSettings | null>(null);
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function load(): Promise<void> {
    try {
      const next = await getSearchConsoleSettings(projectId);
      setSettings(next);
      setSelected(next.link?.propertyUrl ?? '');
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load the Search Console settings.');
    }
  }
  useEffect(() => { void load(); }, [projectId]);

  async function act(work: () => Promise<unknown>, success: string): Promise<void> {
    setBusy(true); setError(''); setNotice('');
    try {
      await work();
      setNotice(success);
      await load();
      onSynced();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The action could not be completed.');
    } finally {
      setBusy(false);
    }
  }

  async function sync(): Promise<void> {
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await syncSearchConsoleRanks(projectId);
      const parts = [`${result.fetched} rank(s) updated`];
      if (result.unavailable > 0) parts.push(`${result.unavailable} not ranking`);
      if (result.skipped > 0) parts.push(`${result.skipped} not automatable`);
      setNotice(parts.join(' · '));
      if (result.status === 'failed' && result.message) setError(result.message);
      await load();
      onSynced();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The sync could not be completed.');
    } finally {
      setBusy(false);
    }
  }

  if (settings === null) {
    return <Card>{error ? <Notice error>{error}</Notice> : <Loading />}</Card>;
  }

  const link = settings.link;
  const options = [
    { value: '', label: settings.properties.length === 0 ? 'No properties available' : 'Choose a property…' },
    // A linked property that the account can no longer list must still appear,
    // or the select would silently show "Choose a property…" for a live link.
    ...(link !== null && !settings.properties.some((p) => p.propertyUrl === link.propertyUrl)
      ? [{ value: link.propertyUrl, label: `${link.propertyUrl} (no longer listed)` }]
      : []),
    ...settings.properties.map((property) => ({ value: property.propertyUrl, label: property.propertyUrl })),
  ];

  return <Card>
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h3 className="font-display text-lg font-bold">Google Search Console</h3>
        <p className="mt-1 max-w-2xl text-xs text-app-muted">
          Keywords with a fetch frequency are updated automatically from this property. Search Console reports the
          <strong> average position</strong> over a recent window and runs about three days behind, so a value here is a
          trend signal rather than a live SERP rank. Bing, GMB and city-scoped keywords are not covered and stay manual.
        </p>
      </div>
      {link !== null && <Button kind="secondary" disabled={busy} onClick={() => { void sync(); }}>{busy ? 'Working…' : 'Sync now'}</Button>}
    </div>

    {notice && <div className="mb-3"><Notice>{notice}</Notice></div>}
    {error && <div className="mb-3"><Notice error>{error}</Notice></div>}
    {!settings.configured && <div className="mb-3"><Notice error>Google Search Console is not configured on this server. Set GOOGLE_SEARCH_CONSOLE_AUTH to enable automatic fetching.</Notice></div>}
    {settings.configured && settings.error !== null && <div className="mb-3"><Notice error>{settings.error}</Notice></div>}

    <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
      <Select label="Property" value={selected} onChange={setSelected} options={options} />
      <Button
        disabled={busy || selected === '' || selected === link?.propertyUrl}
        onClick={() => { void act(() => linkSearchConsoleProperty(projectId, selected), 'Property linked.'); }}
      >
        {link === null ? 'Link property' : 'Change property'}
      </Button>
      {link !== null && (
        <Button
          kind="secondary"
          disabled={busy}
          onClick={() => { if (window.confirm('Unlink this property? Automatic rank fetching will stop for this project.')) void act(() => unlinkSearchConsoleProperty(projectId), 'Property unlinked.'); }}
        >
          Unlink
        </Button>
      )}
    </div>

    {link !== null && (
      <p className="mt-3 text-xs text-app-muted">
        Last sync:{' '}
        {link.lastSyncAt === null ? <span>never run</span> : <>
          <span className={link.lastSyncStatus === null ? '' : syncTone[link.lastSyncStatus]}>{link.lastSyncStatus ?? 'unknown'}</span>
          {' · '}{new Date(link.lastSyncAt).toLocaleString()}
          {' · '}{link.keywordsSynced} keyword(s) updated
          {link.lastSyncMessage !== null && <> · {link.lastSyncMessage}</>}
        </>}
      </p>
    )}
  </Card>;
}
