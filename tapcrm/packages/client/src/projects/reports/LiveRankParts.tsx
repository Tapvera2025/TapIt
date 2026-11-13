import { useState } from 'react';
import { Button, Modal, Notice } from '../../ui/index.js';
import { updateProjectLiveSettings, type LiveCheckOutcome, type LiveTopResult, type ProjectLiveSettings } from './api/projectReportsApi.js';
import type { SeoKeyword } from './types.js';

/**
 * Pieces shared by everything that runs a live position check on a project
 * keyword: the SEO dashboard's Projects area and its Keyword search.
 */

export const DEPTH_OPTIONS: Array<{ value: ProjectLiveSettings['searchDepth']; label: string }> = [
  { value: 10, label: 'First 10 results (1 search)' },
  { value: 20, label: 'First 20 results (up to 2 searches)' },
  { value: 30, label: 'First 30 results (up to 3 searches)' },
  { value: 50, label: 'First 50 results (up to 5 searches)' },
  { value: 100, label: 'First 100 results (up to 10 searches)' },
];

export const ENGINE_LABEL: Record<string, string> = {
  google: 'Google',
  bing: 'Bing',
  google_local: 'Google map pack',
};

const field =
  'w-full rounded-lg border border-app-border bg-app-background px-3 py-2.5 text-sm text-app-foreground outline-none focus:border-app-accent disabled:opacity-60';

export function whereLabel(keyword: Pick<SeoKeyword, 'searchEngine' | 'category'>): string {
  if (keyword.category === 'gmb') return 'Google map pack';
  return keyword.searchEngine === 'bing' ? 'Bing' : 'Google';
}

export function keywordLocation(keyword: Pick<SeoKeyword, 'city' | 'country'>): string {
  const country = keyword.country && keyword.country.toLowerCase() !== 'global' ? keyword.country : 'Worldwide';
  return keyword.city ? `${keyword.city}, ${country}` : country;
}

/** Is a live check possible right now, and if not, why — in plain words. */
export function liveReadiness(settings: ProjectLiveSettings | null): { ready: boolean; reason: string } {
  if (!settings) return { ready: false, reason: 'Loading live-check settings…' };
  if (!settings.configured)
    return { ready: false, reason: 'Live search is not set up on the server yet (SerpApi key). Rankings fall back to Search Console where a project is linked to it.' };
  if (settings.monthlyLimit === 0)
    return { ready: false, reason: 'Live checks are off for this project. Set a monthly allowance in the live-check settings to turn them on.' };
  if (settings.remaining === 0)
    return { ready: false, reason: 'This project’s live checks for this month are used up. Raise the allowance or wait for next month.' };
  return { ready: true, reason: '' };
}

/** A compact status line: website, allowance and depth, with a settings button. */
export function LiveStatusBar({
  settings,
  canManage,
  onSettings,
}: {
  settings: ProjectLiveSettings;
  canManage: boolean;
  onSettings: () => void;
}): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-app-border bg-app-surface px-4 py-3 text-xs">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-app-muted">
        <span>
          Website:{' '}
          <strong className="text-app-foreground">{settings.effectiveHost ?? 'not set'}</strong>
          {settings.websiteSource === 'search-console' && ' (from Search Console link)'}
        </span>
        <span>
          Live checks this month:{' '}
          <strong className="text-app-foreground">
            {settings.monthlyLimit === 0 ? 'off' : `${settings.remaining} of ${settings.monthlyLimit} left`}
          </strong>
        </span>
        <span>
          Looks through: <strong className="text-app-foreground">first {settings.searchDepth} results</strong>
        </span>
      </div>
      {canManage && (
        <Button kind="secondary" onClick={onSettings} className="!px-3 !py-1.5 !text-xs">
          Live-check settings
        </Button>
      )}
    </div>
  );
}

export function LiveSettingsModal({
  projectId,
  settings,
  onClose,
  onSaved,
}: {
  projectId: string;
  settings: ProjectLiveSettings;
  onClose: () => void;
  onSaved: (next: ProjectLiveSettings) => void;
}): React.JSX.Element {
  const [website, setWebsite] = useState(settings.websiteUrl ?? '');
  const [limit, setLimit] = useState(String(settings.monthlyLimit));
  const [depth, setDepth] = useState<ProjectLiveSettings['searchDepth']>(settings.searchDepth);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  async function save(): Promise<void> {
    const parsed = Number(limit);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 100000)
      return setError('Enter a monthly allowance between 0 and 100,000 searches.');
    const site = website.trim();
    if (site) {
      try {
        const url = new URL(/^https?:\/\//i.test(site) ? site : `https://${site}`);
        if (!url.hostname.includes('.')) throw new Error('bad host');
      } catch {
        return setError('Enter the website as an address, e.g. https://example.com.');
      }
    }
    setSaving(true);
    setError('');
    try {
      onSaved(await updateProjectLiveSettings(projectId, { websiteUrl: site || null, monthlyLimit: parsed, searchDepth: depth }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Settings could not be saved.');
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal
      title="Live-check settings"
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <Button kind="secondary" onClick={onClose}>Cancel</Button>
          <Button disabled={saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save settings'}</Button>
        </div>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-app-muted">
          A live check searches Google or Bing right now, for the keyword’s country, city and device, and finds where the
          website is. Every page of 10 results is one paid search, so the allowance caps what this project can spend each
          month. 0 turns live checks off.
        </p>
        {error && <Notice error>{error}</Notice>}
        <label className="block text-xs font-semibold text-app-muted">
          Project website
          <input className={`mt-2 ${field}`} value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://example.com" />
          <span className="mt-1 block font-normal">
            Used for keywords without a target URL.
            {!settings.websiteUrl && settings.websiteSource === 'search-console' && ` Right now the linked Search Console property gives ${settings.effectiveHost}.`}
          </span>
        </label>
        <label className="block text-xs font-semibold text-app-muted">
          Monthly allowance (searches)
          <input className={`mt-2 ${field}`} type="number" min={0} max={100000} value={limit} onChange={(e) => setLimit(e.target.value)} />
          <span className="mt-1 block font-normal">Used this month: {settings.used}.</span>
        </label>
        <label className="block text-xs font-semibold text-app-muted">
          How deep each check looks
          <select className={`mt-2 ${field}`} value={depth} onChange={(e) => setDepth(Number(e.target.value) as ProjectLiveSettings['searchDepth'])}>
            {DEPTH_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <span className="mt-1 block font-normal">A check stops as soon as the website is found, so most use fewer searches.</span>
        </label>
      </div>
    </Modal>
  );
}

/** The keyword's latest live reading, for a table cell. */
export function LiveCell({ keyword }: { keyword: SeoKeyword }): React.JSX.Element {
  if (!keyword.lastLiveCheckAt || !keyword.lastLiveOutcome) return <span className="text-xs text-app-muted">Not checked</span>;
  const when = new Date(keyword.lastLiveCheckAt).toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  if (keyword.lastLiveOutcome === 'found')
    return (
      <div className="flex flex-col gap-0.5">
        <span className="w-fit rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-bold text-emerald-700 dark:text-emerald-300">#{keyword.lastLivePosition}</span>
        <span className="text-[11px] text-app-muted">{keyword.lastLiveLocation} · {when}</span>
      </div>
    );
  if (keyword.lastLiveOutcome === 'not-found')
    return (
      <div className="flex flex-col gap-0.5">
        <span className="w-fit rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:text-amber-300">Not in top {keyword.lastLiveDepth ?? ''}</span>
        <span className="text-[11px] text-app-muted">{keyword.lastLiveLocation} · {when}</span>
      </div>
    );
  return (
    <div className="flex flex-col gap-0.5" title={keyword.lastLiveMessage ?? undefined}>
      <span className="w-fit cursor-help rounded-full bg-red-500/10 px-2 py-0.5 text-xs font-semibold text-red-600">Check failed</span>
      <span className="text-[11px] text-app-muted">{when}</span>
    </div>
  );
}

function TopResults({ items, highlight }: { items: LiveTopResult[]; highlight: number | null }): React.JSX.Element | null {
  if (items.length === 0) return null;
  return (
    <div className="mt-3">
      <p className="text-[10px] font-bold uppercase tracking-wide text-app-muted">Top of the results page</p>
      <ol className="mt-1.5 space-y-1">
        {items.map((item) => (
          <li key={`${item.position}-${item.url ?? item.title}`} className={`flex min-w-0 items-center gap-2 rounded-lg px-2 py-1 text-xs ${item.position === highlight ? 'bg-emerald-500/10 font-semibold' : ''}`}>
            <span className="w-7 shrink-0 tabular-nums text-app-muted">#{item.position}</span>
            <span className="min-w-0 flex-1 truncate" title={item.url ?? undefined}>{item.title ?? item.url ?? 'Untitled result'}</span>
            {item.url && <span className="hidden max-w-56 shrink-0 truncate text-[11px] text-app-muted sm:inline">{hostLabel(item.url)}</span>}
          </li>
        ))}
      </ol>
    </div>
  );
}

function hostLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** What one live check found, in full. */
export function OutcomeCard({ keyword, outcome }: { keyword: string; outcome: LiveCheckOutcome }): React.JSX.Element {
  if (outcome.status === 'failed')
    return <Notice error>“{keyword}”: {outcome.message ?? 'The check could not be completed.'}</Notice>;
  const found = outcome.status === 'found';
  return (
    <div className={`rounded-xl border p-4 text-sm ${found ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-amber-500/30 bg-amber-500/5'}`}>
      <div className="flex flex-wrap items-center gap-3">
        <span className={`text-2xl font-bold tabular-nums ${found ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-700 dark:text-amber-300'}`}>
          {found ? `#${outcome.position}` : 'Not found'}
        </span>
        <div className="min-w-0">
          <p className="font-semibold">“{keyword}”</p>
          <p className="text-xs text-app-muted">
            {ENGINE_LABEL[outcome.engine] ?? outcome.engine} · {outcome.location} · {outcome.device}
            {outcome.resultsChecked !== null && ` · looked through ${outcome.resultsChecked} results`}
            {outcome.pagesRequested > 0 && ` · ${outcome.pagesRequested} search${outcome.pagesRequested === 1 ? '' : 'es'} used`}
          </p>
        </div>
        {outcome.usedFallback && <span className="rounded-full bg-sky-500/10 px-2 py-1 text-[11px] font-semibold text-sky-700">Search Console average</span>}
      </div>
      {outcome.message && <p className="mt-2 text-xs text-app-muted">{outcome.message}</p>}
      {found && outcome.url && (
        <a href={outcome.url} target="_blank" rel="noreferrer" className="mt-2 block truncate text-xs font-semibold text-app-accent hover:underline">
          {outcome.title ? `${outcome.title} — ` : ''}{outcome.url}
        </a>
      )}
      <TopResults items={outcome.topResults} highlight={outcome.position} />
    </div>
  );
}
