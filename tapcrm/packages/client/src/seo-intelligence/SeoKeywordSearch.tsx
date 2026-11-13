import { useEffect, useRef, useState } from 'react';
import { Button, Card, Modal, Notice, SkeletonTable } from '../ui/index.js';
import { Icon } from '../ui/index.js';
import type { Project } from '../projects/api/projectsApi.js';
import {
  checkKeywordLive,
  createKeyword,
  getProjectRankings,
  type LiveCheckOutcome,
  type ProjectLiveSettings,
} from '../projects/reports/api/projectReportsApi.js';
import {
  DEPTH_OPTIONS,
  ENGINE_LABEL,
  LiveCell,
  LiveSettingsModal,
  LiveStatusBar,
  OutcomeCard,
  keywordLocation,
  liveReadiness,
  whereLabel,
} from '../projects/reports/LiveRankParts.js';
import type { SeoKeyword } from '../projects/reports/types.js';
import * as api from './api.js';
import { SeoProjectPicker } from './SeoProjectPicker.js';
import { SeoBadge, SeoEmptyState, SeoHorizontalBar, SeoSectionHeader } from './SeoUi.js';
import type { SeoSite } from './types.js';

type Mode = 'choose' | 'scan' | 'project';
type Where = 'google:seo' | 'google:gmb' | 'bing:seo';
type Depth = 10 | 20 | 30 | 50 | 100;

const COUNTRY_SUGGESTIONS = ['India', 'United States', 'United Kingdom', 'United Arab Emirates', 'Canada', 'Australia', 'Singapore', 'Global'];
const WHERE_OPTIONS: Array<{ value: Where; label: string }> = [
  { value: 'google:seo', label: 'Google — organic results' },
  { value: 'google:gmb', label: 'Google — local map pack (GMB)' },
  { value: 'bing:seo', label: 'Bing — organic results' },
];

function errorText(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback;
}

function FieldLabel({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <label className="block text-xs font-semibold text-app-muted">
      <span className="mb-1.5 block">{label}</span>
      {children}
      {hint && <span className="mt-1 block font-normal">{hint}</span>}
    </label>
  );
}

function CountryDatalist({ id }: { id: string }): React.JSX.Element {
  return (
    <datalist id={id}>
      {COUNTRY_SUGGESTIONS.map((country) => <option key={country} value={country} />)}
    </datalist>
  );
}

/* ───────────────────────── The popup ───────────────────────── */

function KeywordSearchChooser({
  canScan,
  canViewProjects,
  project,
  onScan,
  onProject,
}: {
  canScan: boolean;
  canViewProjects: boolean;
  project: Project | null;
  onScan: () => void;
  onProject: (project: Project) => void;
}): React.JSX.Element {
  const [step, setStep] = useState<'choose' | 'project'>('choose');
  if (step === 'project')
    return (
      <div className="space-y-3">
        <button type="button" className="text-xs font-semibold text-app-accent hover:underline" onClick={() => setStep('choose')}>
          ← Back
        </button>
        <p className="text-sm text-app-muted">Which project’s keywords do you want to check?</p>
        <SeoProjectPicker value={project} onChange={onProject} autoFocus />
      </div>
    );
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <button
        type="button"
        disabled={!canScan}
        onClick={onScan}
        className="ui-card flex flex-col items-start gap-2 p-5 text-left transition hover:border-app-accent/60 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span className="grid size-10 place-items-center rounded-xl bg-app-accent/10 text-app-accent">
          <Icon name="search" className="size-5" />
        </span>
        <strong>Scan a website</strong>
        <span className="text-sm text-app-muted">
          Search a keyword right now and see where one of your websites ranks — the position, the page that ranks and the
          location searched.
        </span>
        {!canScan && <span className="text-xs text-app-danger">Your role cannot run website scans.</span>}
      </button>
      <button
        type="button"
        disabled={!canViewProjects}
        onClick={() => setStep('project')}
        className="ui-card flex flex-col items-start gap-2 p-5 text-left transition hover:border-app-accent/60 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span className="grid size-10 place-items-center rounded-xl bg-app-accent/10 text-app-accent">
          <Icon name="briefcase" className="size-5" />
        </span>
        <strong>Check an existing project</strong>
        <span className="text-sm text-app-muted">
          Pick a project and see the ranking of its website for the keywords saved on it. You can add a keyword to check, too.
        </span>
        {project && canViewProjects && <span className="text-xs font-semibold text-app-accent">Last opened: {project.name}</span>}
        {!canViewProjects && <span className="text-xs text-app-danger">Your role cannot open projects.</span>}
      </button>
    </div>
  );
}

/* ───────────────────────── Scan a website ───────────────────────── */

function ScanResult({ scan }: { scan: api.SeoRankScan }): React.JSX.Element {
  if (scan.status === 'failed')
    return <Notice error>“{scan.keyword}”: {scan.message ?? 'The scan could not be completed.'}</Notice>;
  const found = scan.status === 'found';
  return (
    <div className={`rounded-2xl border p-5 ${found ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-amber-500/30 bg-amber-500/5'}`}>
      <div className="flex flex-wrap items-center gap-4">
        <div className={`grid min-w-20 place-items-center rounded-2xl px-4 py-3 ${found ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'bg-amber-500/10 text-amber-700 dark:text-amber-300'}`}>
          <span className="text-[10px] font-bold uppercase tracking-wide">{found ? 'Position' : 'Position'}</span>
          <span className="text-3xl font-bold tabular-nums">{found ? `#${scan.position}` : '—'}</span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-lg font-semibold">“{scan.keyword}”</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <SeoBadge tone="info">{ENGINE_LABEL[scan.engine] ?? scan.engine}</SeoBadge>
            <SeoBadge tone="neutral">{scan.searchLocation}</SeoBadge>
            <SeoBadge tone="neutral">{scan.device === 'mobile' ? 'Mobile' : 'Desktop'}</SeoBadge>
          </div>
          <p className="mt-2 text-xs text-app-muted">
            {found ? 'Found' : 'Not found'} in the first {scan.resultsChecked ?? scan.depth} results · {scan.pagesRequested} search
            {scan.pagesRequested === 1 ? '' : 'es'} used · {new Date(scan.createdAt).toLocaleString()}
          </p>
        </div>
      </div>
      {found && scan.rankingUrl && (
        <a href={scan.rankingUrl} target="_blank" rel="noreferrer" className="mt-3 block truncate text-sm font-semibold text-app-accent hover:underline">
          {scan.rankingTitle ? `${scan.rankingTitle} — ` : ''}{scan.rankingUrl}
        </a>
      )}
      {!found && <p className="mt-3 text-sm text-app-muted">{scan.message}</p>}
      {scan.topResults.length > 0 && (
        <div className="mt-4">
          <p className="text-[10px] font-bold uppercase tracking-wide text-app-muted">Top of the results page</p>
          <ol className="mt-1.5 space-y-1">
            {scan.topResults.map((item) => (
              <li key={`${item.position}-${item.url ?? item.title}`} className={`flex min-w-0 items-center gap-2 rounded-lg px-2 py-1 text-xs ${item.position === scan.position ? 'bg-emerald-500/10 font-semibold' : ''}`}>
                <span className="w-7 shrink-0 tabular-nums text-app-muted">#{item.position}</span>
                <span className="min-w-0 flex-1 truncate" title={item.url ?? undefined}>{item.title ?? item.url ?? 'Untitled result'}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

interface ScanForm {
  keyword: string;
  country: string;
  city: string;
  device: 'desktop' | 'mobile';
  where: Where;
  depth: Depth;
}

function ScanWebsiteView({
  sites,
  site,
  onSiteChange,
  onAddSite,
  canScan,
  canManageSite,
  onOpenAllowance,
}: {
  sites: SeoSite[];
  site: SeoSite | null;
  onSiteChange: (id: string) => void;
  onAddSite: () => void;
  canScan: boolean;
  canManageSite: boolean;
  onOpenAllowance: () => void;
}): React.JSX.Element {
  const [form, setForm] = useState<ScanForm>({ keyword: '', country: 'India', city: '', device: 'desktop', where: 'google:seo', depth: 30 });
  const [status, setStatus] = useState<api.SeoRankStatus | null>(null);
  const [scans, setScans] = useState<api.SeoRankScan[] | null>(null);
  const [latest, setLatest] = useState<api.SeoRankScan | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const siteId = site?.id ?? null;
  const current = useRef(siteId);
  current.current = siteId;

  useEffect(() => {
    let live = true;
    setStatus(null);
    setScans(null);
    setLatest(null);
    setError('');
    if (!siteId) return () => { live = false; };
    void Promise.all([api.getSeoRankStatus(siteId), api.listSeoRankScans(siteId)])
      .then(([nextStatus, nextScans]) => {
        if (!live) return;
        setStatus(nextStatus);
        setScans(nextScans);
      })
      .catch((cause: unknown) => {
        if (live) setError(errorText(cause, 'This website’s scans could not be loaded.'));
      });
    return () => { live = false; };
  }, [siteId]);

  function set<K extends keyof ScanForm>(key: K, value: ScanForm[K]): void {
    setForm((value0) => ({ ...value0, [key]: value }));
  }

  async function run(input: ScanForm = form): Promise<void> {
    if (!siteId) return;
    if (!input.keyword.trim()) return setError('Enter a keyword to search for.');
    if (!input.country.trim()) return setError('Enter a country, or “Global”.');
    const [engine, category] = input.where.split(':') as ['google' | 'bing', 'seo' | 'gmb'];
    setRunning(true);
    setError('');
    setLatest(null);
    const requested = siteId;
    try {
      const result = await api.scanSeoRank(siteId, {
        keyword: input.keyword.trim(),
        searchEngine: engine,
        category,
        country: input.country.trim(),
        city: input.city.trim() || null,
        device: input.device,
        depth: input.depth,
      });
      if (current.current !== requested) return;
      setLatest(result.scan);
      setScans((list) => [result.scan, ...(list ?? [])]);
      setStatus((value) => (value ? { ...value, ...result.allowance } : value));
    } catch (cause) {
      if (current.current === requested) setError(errorText(cause, 'The scan could not be run.'));
    } finally {
      setRunning(false);
    }
  }

  if (sites.length === 0)
    return (
      <SeoEmptyState
        title="Add a website to scan"
        description="Scans look for one of your SEO websites in the search results. Add the website first; its checkup starts at the same time."
        action={canManageSite ? <Button onClick={onAddSite}>Add website</Button> : undefined}
      />
    );

  const engine = form.where.split(':')[0];
  const ready = Boolean(status?.configured && status.monthlyLimit > 0 && status.remaining > 0);
  return (
    <div className="space-y-5">
      <Card>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <FieldLabel label="Website to look for">
            <select className="seo-field w-full" value={siteId ?? ''} onChange={(event) => onSiteChange(event.target.value)}>
              {sites.map((item) => <option key={item.id} value={item.id}>{item.normalizedHost || item.displayUrl}</option>)}
            </select>
          </FieldLabel>
          {canManageSite && (
            <Button kind="secondary" onClick={onAddSite}>
              <Icon name="plus" className="mr-1.5 inline size-4" />
              Add a new website
            </Button>
          )}
        </div>
        {status && (
          <div className="mt-4 grid gap-3 border-t border-app-border pt-4 sm:grid-cols-[minmax(0,1fr)_240px] sm:items-center">
            <div className="text-xs text-app-muted">
              {!status.configured ? (
                <span className="text-app-danger">Live search is not set up on the server yet (SerpApi key). Ask your administrator.</span>
              ) : status.monthlyLimit === 0 ? (
                <>
                  This website has no monthly search allowance, so scans are off.{' '}
                  {canManageSite && <button type="button" className="font-semibold text-app-accent hover:underline" onClick={onOpenAllowance}>Set the allowance</button>}
                </>
              ) : (
                <>
                  <strong className="text-app-foreground">{status.remaining} of {status.monthlyLimit}</strong> searches left this month for this website.
                  Every 10 results looked through is one search; a scan stops as soon as the website is found.{' '}
                  {canManageSite && <button type="button" className="font-semibold text-app-accent hover:underline" onClick={onOpenAllowance}>Change allowance</button>}
                </>
              )}
            </div>
            {status.configured && status.monthlyLimit > 0 && (
              <SeoHorizontalBar value={status.used} max={status.monthlyLimit} label="Searches used" caption="Shared with scheduled position checks." tone="accent" />
            )}
          </div>
        )}
      </Card>

      <Card>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void run();
          }}
          className="space-y-4"
        >
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <FieldLabel label="Keyword">
              <input className="seo-field w-full" value={form.keyword} maxLength={200} onChange={(e) => set('keyword', e.target.value)} placeholder="e.g. best dentist in mumbai" />
            </FieldLabel>
            <FieldLabel label="Country" hint="A name or two-letter code, or “Global”.">
              <input className="seo-field w-full" list="seo-scan-countries" value={form.country} maxLength={100} onChange={(e) => set('country', e.target.value)} />
              <CountryDatalist id="seo-scan-countries" />
            </FieldLabel>
            <FieldLabel label="City (optional)" hint="Searches as if from this city.">
              <input className="seo-field w-full" value={form.city} maxLength={100} onChange={(e) => set('city', e.target.value)} placeholder="e.g. Mumbai" />
            </FieldLabel>
            <FieldLabel label="Where to search">
              <select className="seo-field w-full" value={form.where} onChange={(e) => set('where', e.target.value as Where)}>
                {WHERE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </FieldLabel>
            <FieldLabel label="Device">
              <select className="seo-field w-full" value={form.device} onChange={(e) => set('device', e.target.value as 'desktop' | 'mobile')}>
                <option value="desktop">Desktop</option>
                <option value="mobile">Mobile</option>
              </select>
            </FieldLabel>
            <FieldLabel label="How deep to look">
              <select className="seo-field w-full" value={form.depth} onChange={(e) => set('depth', Number(e.target.value) as Depth)}>
                {DEPTH_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </FieldLabel>
          </div>
          {form.where === 'google:gmb' && (
            <p className="text-xs text-app-muted">
              The map pack is matched by the website’s address, or by the linked client’s business name when a listing has no website.
            </p>
          )}
          {error && <Notice error>{error}</Notice>}
          <div className="flex flex-wrap items-center justify-end gap-3">
            {!canScan && <span className="text-xs text-app-muted">Your role can view scans but not run them.</span>}
            <Button type="submit" disabled={running || !canScan || !ready}>
              <Icon name="search" className="mr-1.5 inline size-4" />
              {running ? `Searching ${engine === 'bing' ? 'Bing' : 'Google'}…` : 'Scan now'}
            </Button>
          </div>
        </form>
      </Card>

      {latest && <ScanResult scan={latest} />}

      <section className="seo-surface p-5 sm:p-6">
        <div className="mb-4">
          <h3 className="seo-subtitle">Recent scans for this website</h3>
          <p className="seo-small-copy mt-1">Every scan is kept, so you can compare positions over time.</p>
        </div>
        {scans === null ? (
          <SkeletonTable columns={6} rows={3} />
        ) : scans.length === 0 ? (
          <p className="seo-small-copy">No scans yet. Run one above.</p>
        ) : (
          <div className="seo-table-wrap">
            <table className="seo-table">
              <thead>
                <tr>
                  <th>Keyword</th>
                  <th>Position</th>
                  <th>Where</th>
                  <th>Ranking page</th>
                  <th>When</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {scans.slice(0, 50).map((scan) => (
                  <tr key={scan.id}>
                    <td className="min-w-44 font-semibold">{scan.keyword}</td>
                    <td className="whitespace-nowrap">
                      {scan.status === 'found' ? (
                        <SeoBadge tone={scan.position! <= 10 ? 'accent' : 'neutral'}>#{scan.position}</SeoBadge>
                      ) : scan.status === 'not-found' ? (
                        <span className="text-xs text-app-muted">Not in top {scan.resultsChecked ?? scan.depth}</span>
                      ) : (
                        <span className="cursor-help text-xs text-app-danger" title={scan.message ?? undefined}>Failed</span>
                      )}
                    </td>
                    <td className="min-w-40 text-xs">
                      {ENGINE_LABEL[scan.engine] ?? scan.engine} · {scan.searchLocation} · {scan.device}
                    </td>
                    <td className="max-w-64 truncate text-xs">
                      {scan.rankingUrl ? (
                        <a href={scan.rankingUrl} target="_blank" rel="noreferrer" className="text-app-accent hover:underline" title={scan.rankingUrl}>{scan.rankingUrl}</a>
                      ) : '—'}
                    </td>
                    <td className="whitespace-nowrap text-xs text-app-muted">
                      {new Date(scan.createdAt).toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}
                      {scan.requestedByName ? ` · ${scan.requestedByName}` : ''}
                    </td>
                    <td>
                      {canScan && (
                        <button
                          type="button"
                          className="seo-text-action"
                          disabled={running || !ready}
                          onClick={() => {
                            const next: ScanForm = {
                              keyword: scan.keyword,
                              country: scan.country,
                              city: scan.city ?? '',
                              device: scan.device,
                              where: scan.engine === 'google_local' ? 'google:gmb' : scan.engine === 'bing' ? 'bing:seo' : 'google:seo',
                              depth: (DEPTH_OPTIONS.some((option) => option.value === scan.depth) ? scan.depth : 30) as Depth,
                            };
                            setForm(next);
                            void run(next);
                          }}
                        >
                          Scan again
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

/* ───────────────────────── Check an existing project ───────────────────────── */

interface NewKeyword {
  keyword: string;
  targetUrl: string;
  country: string;
  city: string;
  device: 'desktop' | 'mobile';
  where: Where;
  priority: 'low' | 'medium' | 'high';
  checkNow: boolean;
}

function AddKeywordModal({
  project,
  canCheck,
  onClose,
  onAdded,
}: {
  project: Project;
  canCheck: boolean;
  onClose: () => void;
  onAdded: (keyword: SeoKeyword, checkNow: boolean) => void;
}): React.JSX.Element {
  const [form, setForm] = useState<NewKeyword>({ keyword: '', targetUrl: '', country: 'India', city: '', device: 'desktop', where: 'google:seo', priority: 'medium', checkNow: canCheck });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  function set<K extends keyof NewKeyword>(key: K, value: NewKeyword[K]): void {
    setForm((current) => ({ ...current, [key]: value }));
  }
  async function save(): Promise<void> {
    const keyword = form.keyword.trim();
    if (!keyword) return setError('Enter a keyword.');
    if (!form.country.trim()) return setError('Enter a country, or “Global”.');
    const targetUrl = form.targetUrl.trim();
    if (targetUrl) {
      try {
        const url = new URL(targetUrl);
        if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('protocol');
      } catch {
        return setError('Enter the target URL as a full address beginning with https://, or leave it empty.');
      }
    }
    const [engine, category] = form.where.split(':') as ['google' | 'bing', 'seo' | 'gmb'];
    setSaving(true);
    setError('');
    try {
      const created = await createKeyword(project.id, {
        keyword,
        currentRank: null,
        targetUrl: targetUrl || null,
        keywordLink: null,
        searchEngine: engine,
        country: form.country.trim(),
        city: form.city.trim() || null,
        device: form.device,
        autoFetchFrequency: 'manual',
        priority: form.priority,
        category,
        notes: null,
      });
      onAdded(created, form.checkNow && canCheck);
    } catch (cause) {
      setError(errorText(cause, 'The keyword could not be added.'));
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal
      title={`Add a keyword to ${project.name}`}
      onClose={onClose}
      size="lg"
      footer={
        <div className="flex justify-end gap-2">
          <Button kind="secondary" onClick={onClose}>Cancel</Button>
          <Button disabled={saving} onClick={() => void save()}>{saving ? 'Adding…' : form.checkNow && canCheck ? 'Add and check' : 'Add keyword'}</Button>
        </div>
      }
    >
      <div className="space-y-4">
        {error && <Notice error>{error}</Notice>}
        <div className="grid gap-4 md:grid-cols-2">
          <FieldLabel label="Keyword *">
            <input className="seo-field w-full" value={form.keyword} maxLength={200} onChange={(e) => set('keyword', e.target.value)} />
          </FieldLabel>
          <FieldLabel label="Target URL (optional)" hint="Leave empty to look for the project website.">
            <input className="seo-field w-full" value={form.targetUrl} maxLength={2000} onChange={(e) => set('targetUrl', e.target.value)} placeholder="https://example.com/page" />
          </FieldLabel>
          <FieldLabel label="Country *">
            <input className="seo-field w-full" list="seo-add-countries" value={form.country} maxLength={100} onChange={(e) => set('country', e.target.value)} />
            <CountryDatalist id="seo-add-countries" />
          </FieldLabel>
          <FieldLabel label="City (optional)">
            <input className="seo-field w-full" value={form.city} maxLength={100} onChange={(e) => set('city', e.target.value)} />
          </FieldLabel>
          <FieldLabel label="Where to search">
            <select className="seo-field w-full" value={form.where} onChange={(e) => set('where', e.target.value as Where)}>
              {WHERE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </FieldLabel>
          <FieldLabel label="Device">
            <select className="seo-field w-full" value={form.device} onChange={(e) => set('device', e.target.value as 'desktop' | 'mobile')}>
              <option value="desktop">Desktop</option>
              <option value="mobile">Mobile</option>
            </select>
          </FieldLabel>
          <FieldLabel label="Priority">
            <select className="seo-field w-full" value={form.priority} onChange={(e) => set('priority', e.target.value as NewKeyword['priority'])}>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </FieldLabel>
        </div>
        <label className={`flex items-center gap-2 text-sm ${canCheck ? '' : 'opacity-50'}`}>
          <input type="checkbox" checked={form.checkNow && canCheck} disabled={!canCheck} onChange={(e) => set('checkNow', e.target.checked)} />
          Check its position right away
          {!canCheck && <span className="text-xs text-app-muted">(live checks are off for this project)</span>}
        </label>
      </div>
    </Modal>
  );
}

function ProjectRankingsView({
  project,
  canManage,
  onChangeProject,
}: {
  project: Project;
  canManage: boolean;
  onChangeProject: () => void;
}): React.JSX.Element {
  const [keywords, setKeywords] = useState<SeoKeyword[] | null>(null);
  const [settings, setSettings] = useState<ProjectLiveSettings | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');
  const [last, setLast] = useState<{ keyword: string; outcome: LiveCheckOutcome } | null>(null);
  const [adding, setAdding] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; keyword: string } | null>(null);
  const stop = useRef(false);
  const projectRef = useRef(project.id);
  projectRef.current = project.id;

  async function load(): Promise<void> {
    const requested = project.id;
    try {
      const rankings = await getProjectRankings(requested);
      if (projectRef.current !== requested) return;
      setKeywords(rankings.keywords);
      setSettings(rankings.settings);
      setError('');
    } catch (cause) {
      if (projectRef.current === requested) setError(errorText(cause, 'This project’s keywords could not be loaded.'));
    }
  }
  useEffect(() => {
    setKeywords(null);
    setSettings(null);
    setLast(null);
    setNotice('');
    setProgress(null);
    stop.current = true;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  function replaceKeyword(next: SeoKeyword): void {
    setKeywords((list) => (list ?? []).map((item) => (item.id === next.id ? next : item)));
  }

  async function checkOne(keyword: SeoKeyword): Promise<LiveCheckOutcome | null> {
    try {
      const result = await checkKeywordLive(project.id, keyword.id);
      if (projectRef.current !== project.id) return null;
      replaceKeyword(result.keyword);
      setLast({ keyword: keyword.keyword, outcome: result.outcome });
      return result.outcome;
    } catch (cause) {
      setError(errorText(cause, `“${keyword.keyword}” could not be checked.`));
      return null;
    }
  }

  async function check(keyword: SeoKeyword): Promise<void> {
    setBusy(keyword.id);
    setError('');
    setNotice('');
    await checkOne(keyword);
    await load();
    setBusy('');
  }

  async function checkAll(): Promise<void> {
    if (!keywords?.length) return;
    stop.current = false;
    setBusy('all');
    setError('');
    setNotice('');
    let done = 0;
    let found = 0;
    for (const keyword of keywords) {
      if (stop.current) break;
      setProgress({ done, total: keywords.length, keyword: keyword.keyword });
      const outcome = await checkOne(keyword);
      done += 1;
      if (outcome?.status === 'found') found += 1;
      // Out of allowance (or provider down without a fallback): stop rather than fail the rest.
      if (!outcome || (outcome.status === 'failed' && /allowance|not configured|could not be reached|rejected/i.test(outcome.message ?? ''))) break;
    }
    setProgress(null);
    setBusy('');
    await load();
    setNotice(`${done} of ${keywords.length} keyword${keywords.length === 1 ? '' : 's'} checked; ${found} found in the results.`);
  }

  const readiness = liveReadiness(settings);
  const canCheck = canManage && readiness.ready;
  return (
    <div className="space-y-4">
      <div className="seo-surface flex flex-wrap items-center justify-between gap-4 p-4 sm:p-5">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-app-accent/10 text-app-accent">
            <Icon name="briefcase" className="size-5" />
          </span>
          <div className="min-w-0">
            <p className="truncate font-semibold">{project.name}</p>
            <p className="truncate text-xs text-app-muted">{project.businessName || project.clientName}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button kind="secondary" onClick={onChangeProject} disabled={busy === 'all'}>Change project</Button>
          {canManage && (
            <Button kind="secondary" onClick={() => setAdding(true)} disabled={busy === 'all'}>
              <Icon name="plus" className="mr-1.5 inline size-4" />
              Add a keyword
            </Button>
          )}
          {canManage && busy === 'all' ? (
            <Button kind="danger" onClick={() => { stop.current = true; }}>Stop</Button>
          ) : canManage ? (
            <Button onClick={() => void checkAll()} disabled={!canCheck || !keywords?.length || busy !== ''}>Check all keywords</Button>
          ) : null}
        </div>
      </div>
      {settings && <LiveStatusBar settings={settings} canManage={canManage} onSettings={() => setShowSettings(true)} />}
      {settings && !readiness.ready && <Notice>{readiness.reason}</Notice>}
      {progress && (
        <p role="status" className="text-sm text-app-muted">
          Checking {progress.done + 1} of {progress.total}: “{progress.keyword}”…
        </p>
      )}
      {notice && <Notice>{notice}</Notice>}
      {error && <Notice error>{error}</Notice>}
      {last && <OutcomeCard keyword={last.keyword} outcome={last.outcome} />}
      {keywords === null ? (
        <SkeletonTable columns={5} rows={4} />
      ) : keywords.length === 0 ? (
        <SeoEmptyState
          title="No keywords on this project yet"
          description="Add the keywords you want this project’s website to rank for, then check where it ranks."
          action={canManage ? <Button onClick={() => setAdding(true)}>Add a keyword</Button> : undefined}
        />
      ) : (
        <div className="seo-table-wrap">
          <table className="seo-table">
            <thead>
              <tr>
                <th>Keyword</th>
                <th>Location</th>
                <th>Current rank</th>
                <th>Live position</th>
                <th>Ranking page</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {keywords.map((keyword) => (
                <tr key={keyword.id}>
                  <td className="min-w-48">
                    <strong>{keyword.keyword}</strong>
                    <p className="mt-1 text-xs text-app-muted">
                      {whereLabel(keyword)} · {keyword.device}
                      {keyword.priority === 'high' ? ' · high priority' : ''}
                    </p>
                  </td>
                  <td className="min-w-32 text-xs">{keywordLocation(keyword)}</td>
                  <td className="whitespace-nowrap">
                    {keyword.currentRank !== null ? <SeoBadge tone={keyword.currentRank <= 10 ? 'accent' : 'neutral'}>#{keyword.currentRank}</SeoBadge> : <span className="text-xs text-app-muted">N/A</span>}
                    {keyword.rankChange !== null && keyword.rankChange !== 0 && (
                      <span className={`ml-2 text-xs font-bold ${keyword.rankChange > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                        {keyword.rankChange > 0 ? `▲ ${keyword.rankChange}` : `▼ ${Math.abs(keyword.rankChange)}`}
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap"><LiveCell keyword={keyword} /></td>
                  <td className="max-w-64 truncate text-xs">
                    {keyword.lastLiveUrl ? (
                      <a href={keyword.lastLiveUrl} target="_blank" rel="noreferrer" className="text-app-accent hover:underline" title={keyword.lastLiveUrl}>{keyword.lastLiveUrl}</a>
                    ) : keyword.targetUrl ? (
                      <span className="text-app-muted" title="Target URL">{keyword.targetUrl}</span>
                    ) : '—'}
                  </td>
                  <td className="text-right">
                    {canManage && (
                      <Button kind="secondary" className="!px-3 !py-1.5 !text-xs" disabled={!canCheck || busy !== ''} onClick={() => void check(keyword)}>
                        {busy === keyword.id ? 'Checking…' : 'Check now'}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {adding && (
        <AddKeywordModal
          project={project}
          canCheck={canCheck}
          onClose={() => setAdding(false)}
          onAdded={(created, checkNow) => {
            setAdding(false);
            setKeywords((list) => [...(list ?? []), created]);
            setNotice(`“${created.keyword}” added to ${project.name}.`);
            if (checkNow) void check(created);
            else void load();
          }}
        />
      )}
      {showSettings && settings && (
        <LiveSettingsModal
          projectId={project.id}
          settings={settings}
          onClose={() => setShowSettings(false)}
          onSaved={(next) => {
            setSettings(next);
            setShowSettings(false);
            setNotice('Live-check settings saved.');
          }}
        />
      )}
    </div>
  );
}

/* ───────────────────────── The tab ───────────────────────── */

/**
 * Keyword search: opening the tab asks what to check — scan one of your
 * websites for a keyword, or check the keywords saved on an existing project.
 */
export function SeoKeywordSearch({
  openSignal,
  sites,
  selectedSite,
  onSiteChange,
  onAddSite,
  onOpenAllowance,
  canScan,
  canManageSite,
  canViewProjects,
  canManageProjects,
  project,
  onProjectChange,
}: {
  /** Changes each time the Keyword search tab is clicked: the popup opens again. */
  openSignal: number;
  sites: SeoSite[];
  selectedSite: SeoSite | null;
  onSiteChange: (id: string) => void;
  onAddSite: () => void;
  onOpenAllowance: () => void;
  canScan: boolean;
  canManageSite: boolean;
  canViewProjects: boolean;
  canManageProjects: boolean;
  project: Project | null;
  onProjectChange: (project: Project) => void;
}): React.JSX.Element {
  const [mode, setMode] = useState<Mode>('choose');
  const [open, setOpen] = useState(true);
  const [picking, setPicking] = useState(false);
  useEffect(() => {
    if (openSignal > 0) setOpen(true);
  }, [openSignal]);

  const title = mode === 'scan' ? 'Scan a website' : mode === 'project' ? 'Check an existing project' : 'Keyword search';
  const description =
    mode === 'scan'
      ? 'Search a keyword now and see where your website ranks: the position, the page that ranks and the location searched.'
      : mode === 'project'
        ? 'The ranking of the project’s website for the keywords saved on the project. Check one, or all of them.'
        : 'Check where a website ranks in Google right now — for any keyword, or for the keywords saved on a project.';
  return (
    <div className="seo-panel">
      <SeoSectionHeader
        eyebrow="Keyword search"
        title={title}
        description={description}
        action={<Button onClick={() => setOpen(true)}><Icon name="search" className="mr-1.5 inline size-4" />New keyword search</Button>}
      />
      {mode === 'choose' && (
        <KeywordSearchChooser
          canScan={canScan || canManageSite}
          canViewProjects={canViewProjects}
          project={project}
          onScan={() => setMode('scan')}
          onProject={(next) => {
            onProjectChange(next);
            setMode('project');
          }}
        />
      )}
      {mode === 'scan' && (
        <ScanWebsiteView
          sites={sites}
          site={selectedSite}
          onSiteChange={onSiteChange}
          onAddSite={onAddSite}
          canScan={canScan}
          canManageSite={canManageSite}
          onOpenAllowance={onOpenAllowance}
        />
      )}
      {mode === 'project' && project && (
        <ProjectRankingsView project={project} canManage={canManageProjects} onChangeProject={() => setPicking(true)} />
      )}
      {open && (
        <Modal title="What would you like to check?" onClose={() => setOpen(false)} size="lg" dirty={false}>
          <KeywordSearchChooser
            canScan={canScan || canManageSite}
            canViewProjects={canViewProjects}
            project={project}
            onScan={() => {
              setMode('scan');
              setOpen(false);
            }}
            onProject={(next) => {
              onProjectChange(next);
              setMode('project');
              setOpen(false);
            }}
          />
        </Modal>
      )}
      {picking && (
        <Modal title="Choose a project" onClose={() => setPicking(false)} dirty={false}>
          <SeoProjectPicker
            value={project}
            autoFocus
            onChange={(next) => {
              onProjectChange(next);
              setPicking(false);
            }}
          />
        </Modal>
      )}
    </div>
  );
}
