import { useEffect, useState } from 'react';
import { Button } from '../ui/index.js';
import { SeoBadge, SeoHint, SeoSectionHeader } from './SeoUi.js';
import type {
  SeoAllowanceStatus,
  SeoCrawlSettings,
  SeoSiteSettings,
  SeoSiteSettingsPatch,
} from './api.js';

const SPEEDS = [
  { value: 1000, label: 'Gentle — one page a second' },
  { value: 500, label: 'Normal — two pages a second' },
  { value: 200, label: 'Fast — for websites you run' },
  { value: 0, label: 'No pause — staging or local sites only' },
];

const SOURCES: Array<{
  key: keyof SeoSiteSettings['allowances'];
  title: string;
  unit: string;
  description: string;
}> = [
  {
    key: 'serpSearches',
    title: 'Google searches (SerpApi)',
    unit: 'searches',
    description:
      'Used by Google position checks, Keyword search website scans and Google AI Overview checks. Each page of 10 results looked through is one search.',
  },
  {
    key: 'perplexity',
    title: 'AI answers (Perplexity)',
    unit: 'answers',
    description: 'Used by AI mention checks. Each prompt checked is one request.',
  },
  {
    key: 'moz',
    title: 'Backlink lookups (Moz)',
    unit: 'lookups',
    description: 'Refreshes the links pointing to this website, at most once a week.',
  },
];

export function SeoSiteSettingsPanel({
  settings,
  siteName,
  canManage,
  onSave,
}: {
  settings: SeoSiteSettings;
  siteName: string;
  canManage: boolean;
  onSave: (patch: SeoSiteSettingsPatch) => Promise<void>;
}) {
  const [crawl, setCrawl] = useState<SeoCrawlSettings>(settings.crawl);
  const [exclusions, setExclusions] = useState(settings.crawl.exclusionPatterns.join('\n'));
  const [limits, setLimits] = useState(() => allowanceInputs(settings));
  const [saving, setSaving] = useState<'crawl' | 'sources' | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    setCrawl(settings.crawl);
    setExclusions(settings.crawl.exclusionPatterns.join('\n'));
    setLimits(allowanceInputs(settings));
  }, [settings]);

  const patterns = exclusions
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const crawlDirty =
    JSON.stringify({ ...crawl, exclusionPatterns: patterns }) !== JSON.stringify(settings.crawl);
  const sourcesDirty = SOURCES.some(
    (source) => Number(limits[source.key]) !== settings.allowances[source.key].monthlyLimit,
  );
  const pageLimit = settings.limits.maxPages;
  const invalidPages =
    !Number.isInteger(crawl.maxPages) || crawl.maxPages < pageLimit.min || crawl.maxPages > pageLimit.max;
  const invalidLimits = SOURCES.some((source) => !/^\d{1,6}$/.test(limits[source.key]));

  async function save(kind: 'crawl' | 'sources') {
    setSaving(kind);
    setNotice('');
    setError('');
    try {
      if (kind === 'crawl') {
        await onSave({ crawl: { ...crawl, exclusionPatterns: patterns } });
        setNotice('Checkup settings saved. They apply from the next checkup.');
      } else {
        await onSave({
          allowances: Object.fromEntries(SOURCES.map((s) => [s.key, Number(limits[s.key])])),
        });
        setNotice('Monthly allowances saved.');
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The settings could not be saved.');
    } finally {
      setSaving(null);
    }
  }

  const disabled = !canManage || saving !== null;

  return (
    <div className="seo-panel">
      <SeoSectionHeader
        eyebrow="Website settings"
        title={`How ${siteName} is checked`}
        description="Choose how much of the website a checkup reads and which paid data sources it may use. Changes apply from the next checkup."
      />
      {notice && (
        <p role="status" className="seo-small-copy text-app-accent">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-app-danger">
          {error}
        </p>
      )}

      <section className="seo-surface space-y-5 p-5" aria-labelledby="seo-crawl-heading">
        <div>
          <h3 id="seo-crawl-heading" className="seo-subtitle">
            What each checkup covers
          </h3>
          <p className="seo-small-copy mt-1">
            Pages are found from your sitemaps and from links between your pages, starting at
            your website address.
          </p>
        </div>
        <div className="grid gap-5 md:grid-cols-2">
          <label className="block text-sm font-semibold">
            Most pages to check
            <input
              type="number"
              className="seo-field mt-2 w-full"
              min={pageLimit.min}
              max={pageLimit.max}
              value={Number.isFinite(crawl.maxPages) ? crawl.maxPages : ''}
              disabled={disabled}
              aria-invalid={invalidPages}
              onChange={(event) => setCrawl({ ...crawl, maxPages: Number.parseInt(event.target.value, 10) })}
            />
            <span className="seo-small-copy mt-1 block font-normal">
              {pageLimit.min}–{pageLimit.max.toLocaleString()}. Larger checkups take longer.
            </span>
          </label>
          <label className="block text-sm font-semibold">
            Crawl speed
            <select
              className="seo-field mt-2 w-full"
              value={crawl.crawlDelayMs}
              disabled={disabled}
              onChange={(event) => setCrawl({ ...crawl, crawlDelayMs: Number(event.target.value) })}
            >
              {SPEEDS.some((speed) => speed.value === crawl.crawlDelayMs) ? null : (
                <option value={crawl.crawlDelayMs}>Custom — {crawl.crawlDelayMs} ms between pages</option>
              )}
              {SPEEDS.map((speed) => (
                <option key={speed.value} value={speed.value}>
                  {speed.label}
                </option>
              ))}
            </select>
            <span className="seo-small-copy mt-1 block font-normal">
              A website's robots.txt can ask for a slower pace; that request is always honoured.
            </span>
          </label>
          <label className="block text-sm font-semibold">
            Pages built with JavaScript
            <select
              className="seo-field mt-2 w-full"
              value={crawl.renderPolicy}
              disabled={disabled || !settings.renderingAvailable}
              onChange={(event) =>
                setCrawl({ ...crawl, renderPolicy: event.target.value as SeoCrawlSettings['renderPolicy'] })
              }
            >
              <option value="never">Read the HTML only</option>
              <option value="heuristic">Render pages that look empty without JavaScript</option>
              <option value="always">Render every page</option>
            </select>
            <span className="seo-small-copy mt-1 block font-normal">
              {settings.renderingAvailable
                ? 'Rendering shows what a browser sees after scripts run. It is slower.'
                : 'Rendering is not set up on this server, so pages are read as HTML.'}
            </span>
          </label>
          {crawl.renderPolicy !== 'never' && (
            <label className="block text-sm font-semibold">
              Most pages to render
              <input
                type="number"
                className="seo-field mt-2 w-full"
                min={1}
                max={settings.limits.maxRenderPages.max}
                value={crawl.maxRenderPages}
                disabled={disabled}
                onChange={(event) =>
                  setCrawl({ ...crawl, maxRenderPages: Number.parseInt(event.target.value, 10) || 0 })
                }
              />
            </label>
          )}
          <label className="block text-sm font-semibold">
            How the checkup identifies itself
            <select
              className="seo-field mt-2 w-full"
              value={crawl.crawlerIdentity}
              disabled={disabled}
              onChange={(event) =>
                setCrawl({ ...crawl, crawlerIdentity: event.target.value as SeoCrawlSettings['crawlerIdentity'] })
              }
            >
              <option value="tapcrm">As the TapCRM SEO bot</option>
              <option value="browser">As a standard browser</option>
            </select>
            <span className="seo-small-copy mt-1 block font-normal">
              Choose a standard browser only for websites you manage whose firewall blocks bots.
            </span>
          </label>
          <label className="block text-sm font-semibold md:col-span-2">
            Skip these addresses
            <textarea
              className="seo-field mt-2 min-h-24 w-full font-mono text-xs"
              placeholder={'/cart\n/account/*\n?sort='}
              value={exclusions}
              disabled={disabled}
              onChange={(event) => setExclusions(event.target.value)}
            />
            <span className="seo-small-copy mt-1 block font-normal">
              One per line. A line matches any address containing it; use * as a wildcard for a
              whole address. Up to {settings.limits.exclusionPatterns.max} lines.
            </span>
          </label>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:gap-6">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={crawl.respectRobots}
              disabled={disabled}
              onChange={(event) => setCrawl({ ...crawl, respectRobots: event.target.checked })}
            />
            Follow the website's robots.txt
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={crawl.followSitemaps}
              disabled={disabled}
              onChange={(event) => setCrawl({ ...crawl, followSitemaps: event.target.checked })}
            />
            Read the website's sitemaps
          </label>
        </div>
        {!crawl.respectRobots && (
          <SeoHint tone="warning" title="Only for websites you manage">
            Ignoring robots.txt can read pages the owner asked crawlers to leave alone.
          </SeoHint>
        )}
        {canManage && (
          <div className="flex justify-end">
            <Button
              disabled={!crawlDirty || invalidPages || patterns.length > settings.limits.exclusionPatterns.max || saving !== null}
              onClick={() => void save('crawl')}
            >
              {saving === 'crawl' ? 'Saving…' : 'Save checkup settings'}
            </Button>
          </div>
        )}
      </section>

      <section className="seo-surface space-y-5 p-5" aria-labelledby="seo-sources-heading">
        <div>
          <h3 id="seo-sources-heading" className="seo-subtitle">
            Paid data sources
          </h3>
          <p className="seo-small-copy mt-1">
            Each source spends from a monthly allowance for this website. An allowance of 0
            keeps it switched off. Failed requests count too.
          </p>
        </div>
        <div className="space-y-4">
          {SOURCES.map((source) => {
            const status = settings.allowances[source.key];
            return (
              <div
                key={source.key}
                className="flex flex-col gap-3 border-t border-app-border pt-4 first:border-t-0 first:pt-0 md:flex-row md:items-start md:justify-between"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <strong className="text-sm">{source.title}</strong>
                    <SourceBadge status={status} />
                  </div>
                  <p className="seo-small-copy mt-1">{source.description}</p>
                  <p className="seo-small-copy mt-1">
                    {status.used.toLocaleString()} of {status.monthlyLimit.toLocaleString()}{' '}
                    {source.unit} used this month.
                  </p>
                </div>
                <label className="block text-sm font-semibold md:w-48">
                  Monthly allowance
                  <input
                    type="number"
                    min={0}
                    max={100000}
                    className="seo-field mt-2 w-full"
                    value={limits[source.key]}
                    disabled={disabled || !status.configured}
                    onChange={(event) => setLimits({ ...limits, [source.key]: event.target.value })}
                  />
                </label>
              </div>
            );
          })}
        </div>
        {canManage && (
          <div className="flex justify-end">
            <Button
              disabled={!sourcesDirty || invalidLimits || saving !== null}
              onClick={() => void save('sources')}
            >
              {saving === 'sources' ? 'Saving…' : 'Save allowances'}
            </Button>
          </div>
        )}
      </section>
    </div>
  );
}

function SourceBadge({ status }: { status: SeoAllowanceStatus }) {
  if (!status.configured) return <SeoBadge>Not set up on this server</SeoBadge>;
  if (status.monthlyLimit === 0) return <SeoBadge tone="warning">Switched off</SeoBadge>;
  if (status.remaining === 0) return <SeoBadge tone="warning">Used up this month</SeoBadge>;
  return <SeoBadge tone="accent">Active</SeoBadge>;
}

function allowanceInputs(settings: SeoSiteSettings): Record<keyof SeoSiteSettings['allowances'], string> {
  return {
    serpSearches: String(settings.allowances.serpSearches.monthlyLimit),
    perplexity: String(settings.allowances.perplexity.monthlyLimit),
    moz: String(settings.allowances.moz.monthlyLimit),
  };
}
