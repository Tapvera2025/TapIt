import { useState } from 'react';
import { getSeoRuleCopy } from '@tapcrm/contracts';
import { Button } from '../ui/components.js';
import { Icon } from '../ui/Icon.js';
import { RuleReference } from './RuleExplanation.js';
import {
  SeoSectionHeader,
  SeoMetricCard,
  SeoEmptyState,
  SeoHint,
  SeoBadge,
  SeoSeverityBadge,
  SeoHorizontalBar,
  type SeoTone,
} from './SeoUi.js';
import { SeoProgressRing } from './SeoVisuals.js';
import { SeoTrafficChart } from './SeoTrafficChart.js';
import {
  searchTrafficModel,
  latestRankObservations,
  publicWebsiteUrl,
} from './seo-dashboard-model.js';
import { getSeoGuidance } from './seo-rule-guidance.js';
import { isScanInFlight, formatElapsed, STATUS_LABEL } from './seo-display.js';
import type { SeoRankStatus, SeoPerformanceStatus } from './api.js';
import type {
  SeoSite,
  SeoScanRun,
  SeoGscMetrics,
  SeoKeyword,
  SeoSerpObservation,
  SeoAiObservation,
  SeoBacklink,
  SeoCwvObservation,
  SeoFixProposal,
  SeoAlert,
} from './types.js';

function SavedRows({ count, shown }: { count: number; shown: number }) {
  return (
    <p className="seo-small-copy">
      Showing {Math.min(count, shown)} of {count} loaded records.
    </p>
  );
}
function WebsiteLink({ url }: { url: string | null }) {
  const href = publicWebsiteUrl(url);
  return href ? (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex max-w-full items-start gap-1.5 break-all text-app-accent hover:underline"
    >
      {url}
      <Icon name="external-link" className="mt-0.5 size-3 shrink-0" />
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  ) : (
    <span className="break-all">{url ?? 'Address unavailable'}</span>
  );
}
function Notice({ error, notice }: { error?: string; notice?: string }) {
  return (
    <>
      {error && (
        <p role="alert" className="text-sm text-app-danger">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="seo-small-copy">
          {notice}
        </p>
      )}
    </>
  );
}

export function SeoSearchPanel({
  metrics,
  site,
  onSync,
  syncing,
  canManage,
  error,
  notice,
  loading,
  onCreateBrief,
}: {
  metrics: SeoGscMetrics[];
  site: SeoSite | null;
  onSync: () => void;
  syncing: boolean;
  canManage: boolean;
  error: string;
  notice: string;
  loading: boolean;
  onCreateBrief?: (query: string) => void;
}) {
  const traffic = searchTrafficModel(metrics);
  const [search, setSearch] = useState('');
  const queries = traffic.queries.filter((row) =>
    row.query.toLowerCase().includes(search.toLowerCase()),
  );
  const shown = queries.slice(0, 25);
  return (
    <div className="seo-panel">
      <SeoSectionHeader
        eyebrow="Search visibility"
        title="Are people finding you on Google?"
        description="See how often your pages appeared in Google results, and how often people clicked through to your website."
        action={
          canManage ? (
            <Button
              kind="secondary"
              onClick={onSync}
              disabled={syncing || loading || !site}
            >
              <Icon name="refresh" className="mr-2 size-4" />
              {syncing ? 'Importing Google data…' : 'Import latest Google data'}
            </Button>
          ) : undefined
        }
      />
      <Notice error={error} notice={notice} />
      {loading ? (
        <p role="status">Loading your Google report…</p>
      ) : metrics.length === 0 ? (
        <SeoEmptyState
          kind="search"
          title="Your Google story starts with data"
          description="No search report has been imported for this website in the latest reporting period. Import data from the connected Google Search Console account. If access is missing, ask your administrator to connect the website’s property."
        />
      ) : (
        <>
          <div className="seo-metric-grid">
            <SeoMetricCard
              icon="eye"
              label="Appearances in Google"
              value={traffic.impressions.toLocaleString()}
              detail="Times a page appeared in a reported search result"
              tone="info"
            />
            <SeoMetricCard
              icon="users"
              label="Visits from Google"
              value={traffic.clicks.toLocaleString()}
              detail="Clicks from search results to your website"
              tone="accent"
            />
            <SeoMetricCard
              icon="arrow"
              label="Appearances that got a click"
              value={traffic.ctr === null ? '—' : `${traffic.ctr.toFixed(1)}%`}
              detail="Click-through rate: clicks divided by appearances"
              tone="warning"
            />
          </div>
          <SeoTrafficChart daily={traffic.daily} />
          <SeoHint title="Read this as a reporting window" icon="calendar">
            The latest 28 complete reporting days end three days ago. Totals cover{' '}
            {metrics.length} loaded rows; Google can omit queries. An average position is
            an average across searches, rather than a fixed live rank.
          </SeoHint>
          <section className="seo-surface p-5 sm:p-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="seo-subtitle">What people searched for</h3>
                <p className="seo-small-copy mt-1">
                  Your strongest reported search terms, ordered by clicks.
                </p>
              </div>
              <label>
                <span className="sr-only">Find a Google search term</span>
                <input
                  className="seo-field text-xs"
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Find a search term…"
                />
              </label>
            </div>
            <div className="seo-table-wrap">
              <table className="seo-table">
                <thead>
                  <tr>
                    <th>Search term</th>
                    <th>Visits</th>
                    <th>Appearances</th>
                    <th>Average position</th>
                    {onCreateBrief && <th>Next step</th>}
                  </tr>
                </thead>
                <tbody>
                  {shown.map((row) => (
                    <tr key={row.query}>
                      <td className="min-w-44 font-semibold">{row.query}</td>
                      <td>{row.clicks.toLocaleString()}</td>
                      <td>{row.impressions.toLocaleString()}</td>
                      <td>
                        {row.positionWeight
                          ? (row.positionSum / row.positionWeight).toFixed(1)
                          : 'Not available'}
                      </td>
                      {onCreateBrief && (
                        <td>
                          <button
                            type="button"
                            className="seo-text-action"
                            onClick={() => onCreateBrief(row.query)}
                          >
                            Plan a helpful page
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {shown.length === 0 && (
              <p className="seo-small-copy mt-4">
                No reported search terms match your search.
              </p>
            )}
            <p className="seo-small-copy mt-4">
              Showing the first {shown.length} of {queries.length} matching terms. A lower
              position number is closer to the top of results.
            </p>
          </section>
        </>
      )}
    </div>
  );
}

export function SeoKeywordsPanel({ keywords }: { keywords: SeoKeyword[] }) {
  const [search, setSearch] = useState('');
  const filtered = keywords.filter((row) =>
    row.keyword.toLowerCase().includes(search.toLowerCase()),
  );
  const intents: Record<string, string> = {
    informational: 'Looking for information',
    transactional: 'Ready to take action',
    commercial: 'Comparing options',
    navigational: 'Looking for a specific website',
  };
  return (
    <div className="seo-panel">
      <SeoSectionHeader
        eyebrow="Search visibility"
        title="The words your audience uses"
        description="Search terms help you understand what people want. Use them to plan helpful pages, rather than adding the same phrase everywhere."
      />
      {keywords.length === 0 ? (
        <SeoEmptyState
          kind="search"
          title="No search terms have been saved yet"
          description="Import a Google traffic report first. Search terms discovered in that report can become tracked keywords for this website."
        />
      ) : (
        <>
          <div className="seo-metric-grid">
            <SeoMetricCard
              icon="search"
              label="Saved search terms"
              value={keywords.length}
              detail="Terms currently loaded for this website"
              tone="accent"
            />
            <SeoMetricCard
              icon="eye"
              label="Tracked for positions"
              value={keywords.filter((row) => row.tracked).length}
              detail="Terms included in configured position checks"
              tone="info"
            />
            <SeoMetricCard
              icon="layers"
              label="With volume data"
              value={keywords.filter((row) => row.searchVolume !== null).length}
              detail="Terms with an available provider estimate"
            />
          </div>
          <label>
            <span className="sr-only">Search saved terms</span>
            <input
              type="search"
              className="seo-field w-full sm:max-w-md"
              placeholder="Find a search term…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <div className="seo-table-wrap">
            <table className="seo-table">
              <thead>
                <tr>
                  <th>Search term</th>
                  <th>What the person wants</th>
                  <th>Search volume</th>
                  <th>Difficulty</th>
                  <th>Position tracking</th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, 100).map((row) => (
                  <tr key={row.id}>
                    <td className="min-w-48">
                      <strong>{row.keyword}</strong>
                      <p className="mt-1 text-xs text-app-muted">
                        {row.country} · {row.device}
                      </p>
                    </td>
                    <td className="min-w-40">
                      {row.intent
                        ? (intents[row.intent] ?? row.intent)
                        : 'Not classified'}
                    </td>
                    <td>
                      {row.searchVolume === null
                        ? 'No data'
                        : row.searchVolume.toLocaleString()}
                    </td>
                    <td>
                      {row.difficulty === null ? 'No data' : `${row.difficulty}/100`}
                    </td>
                    <td>
                      <SeoBadge tone={row.tracked ? 'accent' : 'neutral'}>
                        {row.tracked ? 'Tracked' : 'Not tracked'}
                      </SeoBadge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <SavedRows count={filtered.length} shown={100} />
          <SeoHint title="Missing estimates are not zero searches">
            Volume and difficulty require a supporting data source. Difficulty is a
            provider estimate of competition, not a promise about how a page will rank.
          </SeoHint>
        </>
      )}
    </div>
  );
}

export function SeoRankPanel({
  observations,
  status,
  error,
  notice,
  checking,
  onCheck,
  canManage,
}: {
  observations: SeoSerpObservation[];
  status: SeoRankStatus | null;
  error: string;
  notice: string;
  checking: boolean;
  onCheck: () => void;
  canManage: boolean;
}) {
  const latest = latestRankObservations(observations);
  const ranked = latest.filter((row) => row.organicRank !== null);
  const top10 = ranked.filter((row) => row.organicRank! <= 10).length;
  return (
    <div className="seo-panel">
      <SeoSectionHeader
        eyebrow="Search visibility"
        title="Where do you appear in Google?"
        description="A saved position check is a snapshot for a specific search term, country, and device. Position 1 is the first organic result."
        action={
          canManage ? (
            <Button
              onClick={onCheck}
              disabled={checking || !status?.configured || status.remaining === 0}
            >
              {checking ? 'Queuing checks…' : 'Check positions now'}
            </Button>
          ) : undefined
        }
      />
      <Notice error={error} notice={notice} />
      {status && (
        <div className="seo-surface flex flex-wrap items-center justify-between gap-5 p-5 sm:p-6">
          <div className="max-w-xl">
            <SeoBadge
              tone={status.configured && status.monthlyLimit > 0 ? 'accent' : 'warning'}
            >
              {!status.configured
                ? 'Connection needed'
                : status.monthlyLimit === 0
                  ? 'Monthly allowance needed'
                  : status.remaining === 0
                    ? 'Monthly allowance used'
                    : 'Position checks available'}
            </SeoBadge>
            <h3 className="seo-subtitle mt-3">
              {status.remaining.toLocaleString()} checks available this month
            </h3>
            <p className="seo-small-copy mt-2">
              {status.used} of {status.monthlyLimit} searches used ·{' '}
              {status.trackedKeywords} tracked terms. Each country and device check uses
              one search; failed attempts count too.
            </p>
            {(!status.configured || status.monthlyLimit === 0) && (
              <p className="seo-small-copy mt-2">
                Ask your administrator to configure the search provider and approve a
                monthly allowance.
              </p>
            )}
          </div>
          <div className="min-w-48 flex-1 sm:max-w-64">
            <SeoHorizontalBar
              value={status.used}
              max={status.monthlyLimit}
              label="Monthly checks used"
              caption="The allowance prevents unexpected provider usage."
              tone="accent"
            />
          </div>
        </div>
      )}
      {latest.length === 0 ? (
        <SeoEmptyState
          kind="search"
          title="No position checks yet"
          description="When the provider and allowance are ready, check due terms with the button above. Terms already checked within their configured schedule are skipped."
        />
      ) : (
        <>
          <div className="seo-metric-grid">
            <SeoMetricCard
              icon="search"
              label="Latest search snapshots"
              value={latest.length}
              detail="One per term, country, device, and engine"
              tone="info"
            />
            <SeoMetricCard
              icon="flag"
              label="In the first 10 results"
              value={top10}
              detail="From the latest loaded snapshots"
              tone="accent"
            />
            <SeoMetricCard
              icon="eye-off"
              label="No observed position"
              value={latest.length - ranked.length}
              detail="Not found in the returned results, or unavailable"
            />
          </div>
          <div className="seo-table-wrap">
            <table className="seo-table">
              <thead>
                <tr>
                  <th>Search term</th>
                  <th>Position</th>
                  <th>Country / device</th>
                  <th>Checked</th>
                </tr>
              </thead>
              <tbody>
                {latest.slice(0, 100).map((row) => (
                  <tr key={row.id}>
                    <td className="min-w-48 font-semibold">
                      {row.query ?? 'Search term unavailable'}
                    </td>
                    <td className="min-w-40">
                      {row.organicRank !== null ? (
                        <SeoBadge tone={row.organicRank <= 10 ? 'accent' : 'neutral'}>
                          #{row.organicRank}
                        </SeoBadge>
                      ) : row.state === 'not_observed' ? (
                        'Not seen in returned results'
                      ) : (
                        'Measurement unavailable'
                      )}
                    </td>
                    <td>
                      {row.country} · {row.device}
                    </td>
                    <td className="whitespace-nowrap">
                      {new Date(row.observedAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <SavedRows count={latest.length} shown={100} />
        </>
      )}
      <SeoHint title="A snapshot is not the whole picture">
        Results can differ by location, device, and time. Not being seen in the provider’s
        returned results does not prove the website never ranks. Google traffic shows
        separate average positions.
      </SeoHint>
    </div>
  );
}

export function SeoAiVisibilityPanel({
  observations,
}: {
  observations: SeoAiObservation[];
}) {
  const mentioned = observations.filter((row) => row.brandMentioned === true).length;
  const cited = observations.filter((row) => row.domainCited === true).length;
  const answer = (value: boolean | null, yes: string, no: string) =>
    value === null ? 'Not measured' : value ? yes : no;
  return (
    <div className="seo-panel">
      <SeoSectionHeader
        eyebrow="Search visibility"
        title="Does AI mention your website?"
        description="See saved examples of how supported AI search services mention your brand or link to your pages. Each observation describes one answer, not all AI searches."
      />
      {observations.length === 0 ? (
        <SeoEmptyState
          kind="search"
          title="No AI answer observations yet"
          description="Saved AI answers will appear here when a supported provider has collected them. An empty report does not mean your brand is absent from AI search. Ask your administrator about provider availability."
        />
      ) : (
        <>
          <div className="seo-metric-grid">
            <SeoMetricCard
              icon="message"
              label="Answers recorded"
              value={observations.length}
              detail="Loaded observations, including unavailable answers"
              tone="info"
            />
            <SeoMetricCard
              icon="eye"
              label="Brand mentions"
              value={mentioned}
              detail="Answers that explicitly mentioned your brand"
              tone="accent"
            />
            <SeoMetricCard
              icon="share"
              label="Links to your website"
              value={cited}
              detail="Answers that cited your domain"
              tone="accent"
            />
          </div>
          <div className="space-y-4">
            {observations.slice(0, 50).map((row) => (
              <section key={row.id} className="seo-surface p-5">
                <div className="flex flex-wrap items-center gap-2">
                  <SeoBadge>{row.platform}</SeoBadge>
                  <span className="text-xs text-app-muted">
                    {row.locale} · {new Date(row.observedAt).toLocaleDateString()}
                  </span>
                </div>
                <h3 className="mt-4 text-sm font-semibold">
                  {row.promptText ?? 'Prompt text not available'}
                </h3>
                <div className="mt-4 flex flex-wrap gap-2">
                  <SeoBadge tone={row.brandMentioned === true ? 'accent' : 'neutral'}>
                    {answer(row.brandMentioned, 'Brand mentioned', 'Brand not mentioned')}
                  </SeoBadge>
                  <SeoBadge tone={row.domainCited === true ? 'info' : 'neutral'}>
                    {answer(row.domainCited, 'Website linked', 'Website not linked')}
                  </SeoBadge>
                </div>
                {!['success', 'partial'].includes(row.state) && (
                  <p className="seo-small-copy mt-3">
                    Answer unavailable: {row.state.replaceAll('_', ' ')}. Missing
                    measurements remain unknown.
                  </p>
                )}
                {row.citationUrls.length > 0 && (
                  <details className="mt-4 text-xs text-app-muted">
                    <summary>Sources cited in this answer</summary>
                    <ul className="mt-2 space-y-2">
                      {row.citationUrls.map((url) => (
                        <li key={url}>
                          <WebsiteLink url={url} />
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </section>
            ))}
          </div>
          <SavedRows count={observations.length} shown={50} />
          <SeoHint title="Mentions are observations, not endorsements">
            AI answers change, and providers can have incomplete coverage. A missing
            measurement is not counted as a confirmed absence.
          </SeoHint>
        </>
      )}
    </div>
  );
}

export function SeoBacklinksPanel({ backlinks }: { backlinks: SeoBacklink[] }) {
  const [search, setSearch] = useState('');
  const domains = new Set(
    backlinks.map((row) => {
      try {
        return new URL(row.sourceUrl).hostname;
      } catch {
        return row.sourceUrl;
      }
    }),
  );
  const filtered = backlinks.filter((row) =>
    `${row.sourceUrl} ${row.anchorText ?? ''} ${row.targetUrl}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  return (
    <div className="seo-panel">
      <SeoSectionHeader
        eyebrow="Search visibility"
        title="Who is linking to your website?"
        description="A backlink is a link from another website to yours. Relevant, trustworthy links can help people discover your content."
      />
      {backlinks.length === 0 ? (
        <SeoEmptyState
          kind="links"
          title="No incoming links have been imported"
          description="Your website may still have incoming links. This view only shows records collected by a connected backlink source; a website checkup cannot discover every link across the internet."
        />
      ) : (
        <>
          <div className="seo-metric-grid">
            <SeoMetricCard
              icon="share"
              label="Incoming links"
              value={backlinks.length}
              detail="Link records loaded from available sources"
              tone="accent"
            />
            <SeoMetricCard
              icon="monitor"
              label="Websites linking to you"
              value={domains.size}
              detail="Unique referring domains in these records"
              tone="info"
            />
            <SeoMetricCard
              icon="file-text"
              label="Your linked pages"
              value={new Set(backlinks.map((row) => row.targetUrl)).size}
              detail="Different destinations on your website"
            />
          </div>
          <label>
            <span className="sr-only">Find an incoming link</span>
            <input
              type="search"
              className="seo-field w-full sm:max-w-md"
              placeholder="Search websites or linked pages…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <div className="space-y-3">
            {filtered.slice(0, 100).map((row) => (
              <article className="seo-surface p-5" key={row.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1 text-xs">
                    <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-app-muted">
                      From this website
                    </p>
                    <WebsiteLink url={row.sourceUrl} />
                  </div>
                  {row.domainRating !== null && (
                    <SeoBadge tone="info">
                      Provider authority: {row.domainRating}/100
                    </SeoBadge>
                  )}
                </div>
                <div className="mt-4 border-l-2 border-app-accent/30 pl-4 text-xs">
                  <p className="text-app-muted">
                    {row.anchorText
                      ? `Link text: “${row.anchorText}”`
                      : 'No text label recorded'}
                  </p>
                  <p className="mt-2 text-[10px] font-semibold uppercase tracking-wider text-app-muted">
                    Points to your page
                  </p>
                  <div className="mt-1">
                    <WebsiteLink url={row.targetUrl} />
                  </div>
                </div>
                {row.relValues.includes('nofollow') && (
                  <p className="seo-small-copy mt-4">
                    Marked “nofollow”: the source asks search engines not to pass a
                    standard link signal.
                  </p>
                )}
              </article>
            ))}
          </div>
          <SavedRows count={filtered.length} shown={100} />
          <SeoHint title="Quality matters more than a large count">
            Authority is a source-specific estimate, not a Google score. Review relevance
            and context before taking action on a link.
          </SeoHint>
        </>
      )}
    </div>
  );
}

function SpeedMetric({
  title,
  acronym,
  value,
  rating,
  target,
  description,
}: {
  title: string;
  acronym: string;
  value: string;
  rating: string | null;
  target: string;
  description: string;
}) {
  const tone: SeoTone =
    rating === 'good'
      ? 'accent'
      : rating === 'poor'
        ? 'danger'
        : rating === 'needs_improvement'
          ? 'warning'
          : 'neutral';
  return (
    <div className={`seo-surface seo-tone-${tone} p-5`}>
      <div className="flex items-center justify-between gap-2">
        <span className="grid size-9 place-items-center rounded-xl bg-app-surface-raised text-app-muted">
          <Icon
            name={acronym === 'LCP' ? 'monitor' : acronym === 'INP' ? 'arrow' : 'layers'}
            className="size-5"
          />
        </span>
        <SeoBadge tone={tone}>
          {rating === 'good'
            ? 'Good'
            : rating === 'poor'
              ? 'Needs attention'
              : rating === 'needs_improvement'
                ? 'Could improve'
                : 'Not assessed'}
        </SeoBadge>
      </div>
      <h4 className="mt-4 text-sm font-semibold">{title}</h4>
      <p className="mt-2 text-3xl font-bold tracking-tight">{value}</p>
      <p className="mt-3 text-xs leading-6 text-app-muted">{description}</p>
      <p className="mt-4 border-t border-app-border pt-3 text-[11px] text-app-muted">
        {acronym} · Good target: {target}
      </p>
    </div>
  );
}
export function SeoCwvPanel({
  observations,
  statuses,
  error,
  refreshing,
  canManage,
  onRefresh,
}: {
  observations: SeoCwvObservation[];
  statuses: SeoPerformanceStatus[];
  error: string;
  refreshing: boolean;
  canManage: boolean;
  onRefresh: () => void;
}) {
  const sorted = [...observations].sort(
    (a, b) => new Date(b.observedAt).getTime() - new Date(a.observedAt).getTime(),
  );
  const field = sorted.find((row) => row.dataSource === 'crux_api');
  const lab = sorted.filter((row) => row.dataSource === 'lighthouse_lab');
  const crux = statuses.find((row) => row.provider === 'crux');
  const pagespeed = statuses.find((row) => row.provider === 'pagespeed');
  const running = statuses.some((row) => row.state === 'running');
  return (
    <div className="seo-panel">
      <SeoSectionHeader
        eyebrow="Website health"
        title="Is your website comfortable to use?"
        description="A page should load its main content quickly, react to taps, and stay in place while people read it. These measurements help you see where the experience can improve."
        action={
          canManage ? (
            <Button kind="secondary" onClick={onRefresh} disabled={refreshing || running}>
              <Icon name="refresh" className="mr-2 size-4" />
              {refreshing || running ? 'Checking performance…' : 'Test website speed'}
            </Button>
          ) : undefined
        }
      />
      <Notice error={error} />
      <section>
        <div className="mb-5 flex flex-wrap items-center gap-2">
          <h3 className="seo-subtitle mr-auto">What real visitors experienced</h3>
          <SeoBadge tone="info">Google real-user data · CrUX</SeoBadge>
        </div>
        {crux?.message && (
          <div className="mb-4">
            <SeoHint tone={crux.state === 'error' ? 'warning' : 'info'}>
              {crux.message}
            </SeoHint>
          </div>
        )}
        {!field ? (
          <SeoEmptyState
            compact
            title={
              crux?.state === 'running'
                ? 'Gathering real-user measurements…'
                : crux?.state === 'not_configured'
                  ? 'Real-user data needs a connection'
                  : 'No real-user measurements available'
            }
            description={
              crux?.state === 'no_data'
                ? 'Google does not have enough eligible samples for this website and device. This is a data gap, rather than a failed speed test. Use the separate lab test below.'
                : 'Use Test website speed to check availability. If access is missing, your administrator needs an API key with Chrome UX Report access. No measurements means the experience is still unknown.'
            }
          />
        ) : (
          <>
            <p className="seo-small-copy mb-4">
              {field.device ?? 'Mobile'} visitors across this website’s origin · 75% of
              recorded visits performed at least this well · Retrieved{' '}
              {new Date(field.observedAt).toLocaleDateString()}.
            </p>
            <div className="grid gap-4 lg:grid-cols-3">
              <SpeedMetric
                title="Main content appears"
                acronym="LCP"
                value={
                  field.lcpP75 === null
                    ? 'No data'
                    : `${(field.lcpP75 / 1000).toFixed(2)}s`
                }
                rating={field.lcpRating}
                target="2.5 seconds or less"
                description="How long people wait to see the main part of the page."
              />
              <SpeedMetric
                title="Page responds to taps"
                acronym="INP"
                value={field.inpP75 === null ? 'No data' : `${field.inpP75}ms`}
                rating={field.inpRating}
                target="200 milliseconds or less"
                description="How quickly the page reacts when someone clicks or taps."
              />
              <SpeedMetric
                title="Content stays in place"
                acronym="CLS"
                value={field.clsP75 === null ? 'No data' : field.clsP75.toFixed(3)}
                rating={field.clsRating}
                target="0.1 or less"
                description="Whether text and buttons move unexpectedly as the page loads."
              />
            </div>
          </>
        )}
      </section>
      <section className="seo-surface p-5 sm:p-6">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <h3 className="seo-subtitle mr-auto">A controlled page-load test</h3>
          <SeoBadge>Lighthouse lab test</SeoBadge>
        </div>
        <p className="seo-small-copy">
          A simulated mobile visit can help diagnose a page. Its score is a lab result,
          rather than your website’s SEO score or a measurement of every visitor.
        </p>
        {pagespeed?.message && (
          <p
            className="seo-small-copy mt-4"
            role={pagespeed.state === 'error' ? 'alert' : 'status'}
          >
            {pagespeed.message}
          </p>
        )}
        {lab.length === 0 ? (
          <div className="mt-5 rounded-xl border border-dashed border-app-border p-5">
            <p className="text-sm font-semibold">
              {pagespeed?.state === 'running'
                ? 'Running the lab test…'
                : 'No lab tests saved yet'}
            </p>
            <p className="seo-small-copy mt-2">
              {pagespeed?.state === 'running'
                ? 'This can take a few minutes. The report updates when measurements are saved.'
                : 'Use Test website speed above to request a test. It requires an available PageSpeed connection.'}
            </p>
          </div>
        ) : (
          <div className="mt-5 space-y-5">
            {lab.slice(0, 10).map((row) => (
              <div
                className="rounded-xl border border-app-border p-4 sm:p-5"
                key={row.id}
              >
                <div className="flex flex-wrap items-center gap-5">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs">
                      <WebsiteLink url={row.url} />
                    </p>
                    <p className="seo-small-copy mt-2">
                      Measured {new Date(row.observedAt).toLocaleString()}
                    </p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <SeoBadge
                        tone={
                          row.perfScore === null
                            ? 'neutral'
                            : row.perfScore >= 90
                              ? 'accent'
                              : row.perfScore >= 50
                                ? 'warning'
                                : 'danger'
                        }
                      >
                        {row.perfScore === null
                          ? 'Score unavailable'
                          : `Lab performance: ${row.perfScore}/100`}
                      </SeoBadge>
                    </div>
                  </div>
                  {row.perfScore !== null && (
                    <SeoProgressRing
                      value={row.perfScore}
                      total={100}
                      label="Lab score"
                      tone={
                        row.perfScore >= 90
                          ? 'accent'
                          : row.perfScore >= 50
                            ? 'warning'
                            : 'danger'
                      }
                    />
                  )}
                </div>
                <div className="mt-4 grid gap-3 border-t border-app-border pt-4 sm:grid-cols-3">
                  {[
                    {
                      label: 'Main content loads',
                      value:
                        row.labLcpMs === null
                          ? 'No data'
                          : `${(row.labLcpMs / 1000).toFixed(2)}s`,
                    },
                    {
                      label: 'Layout movement',
                      value: row.labCls === null ? 'No data' : row.labCls.toFixed(3),
                    },
                    {
                      label: 'Time the page is blocked',
                      value: row.labTbtMs === null ? 'No data' : `${row.labTbtMs}ms`,
                    },
                  ].map((item) => (
                    <div key={item.label}>
                      <p className="text-[11px] text-app-muted">{item.label}</p>
                      <p className="mt-1 text-base font-semibold">{item.value}</p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
      <SeoHint title="Two sources, two different views">
        Real-user measurements reflect Google’s eligible visitors. Lab tests simulate a
        mobile visit. Lab blocking time (TBT) does not measure the real-user response
        metric (INP). Share the affected pages and source with your developer.
      </SeoHint>
    </div>
  );
}

export function SeoFixStudioPanel({
  fixes,
  canManage,
  onApply,
}: {
  fixes: SeoFixProposal[];
  canManage: boolean;
  onApply: (id: string) => void;
}) {
  const pending = fixes.filter((row) => ['draft', 'pending_review'].includes(row.status));
  const [confirm, setConfirm] = useState<string | null>(null);
  return (
    <div className="seo-panel">
      <SeoSectionHeader
        eyebrow="Website health"
        title="A practical plan for your next improvements"
        description="Read each recommendation, review it with your website developer, and make the change in your website editor. Mark it done here only after the work is complete."
      />
      {fixes.length === 0 ? (
        <SeoEmptyState
          title="No recommended fixes saved yet"
          description="Recommendations appear when your checkup and configured analysis produce them. You can still open Issues to review for plain-language guidance and evidence on each finding."
        />
      ) : (
        <>
          <div className="seo-metric-grid">
            <SeoMetricCard
              icon="todo"
              label="Ready for review"
              value={pending.length}
              detail="Draft recommendations that need a human decision"
              tone="warning"
            />
            <SeoMetricCard
              icon="check"
              label="Marked as done"
              value={fixes.filter((row) => row.status === 'executed').length}
              detail="Run another checkup to verify the result"
              tone="accent"
            />
            <SeoMetricCard
              icon="layers"
              label="Saved recommendations"
              value={fixes.length}
              detail="Includes other review and execution states"
            />
          </div>
          <SeoHint title="You stay in control">
            Marking a recommendation as done only updates this record. It does not edit or
            deploy your website, and it does not prove the issue is resolved.
          </SeoHint>
          <div className="space-y-4">
            {fixes.map((fix) => (
              <article className="seo-surface p-5 sm:p-6" key={fix.id}>
                <div className="flex flex-wrap gap-2">
                  <SeoSeverityBadge severity={fix.severity} />
                  <SeoBadge tone={fix.status === 'executed' ? 'accent' : 'neutral'}>
                    {fix.status === 'executed'
                      ? 'Marked as done'
                      : fix.status === 'draft' || fix.status === 'pending_review'
                        ? 'Needs your review'
                        : fix.status.replaceAll('_', ' ')}
                  </SeoBadge>
                </div>
                <h3 className="seo-subtitle mt-4">{getSeoRuleCopy(fix.ruleId).title}</h3>
                <p className="seo-small-copy mt-2 break-all">{fix.affectedTarget}</p>
                <div className="mt-5 rounded-xl bg-app-accent/5 p-4">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-app-accent">
                    Recommended next step
                  </p>
                  <p className="mt-2 whitespace-pre-line text-sm leading-7">
                    {getSeoRuleCopy(fix.ruleId).recommendation ??
                      fix.proposedFix ??
                      getSeoGuidance(fix.ruleId).action}
                  </p>
                </div>
                {canManage && ['draft', 'pending_review'].includes(fix.status) && (
                  <div className="mt-5">
                    {confirm === fix.id ? (
                      <div className="flex flex-wrap items-center gap-3">
                        <p className="seo-small-copy">
                          Have you completed this change on the website?
                        </p>
                        <Button
                          kind="secondary"
                          onClick={() => {
                            onApply(fix.id);
                            setConfirm(null);
                          }}
                        >
                          Yes, mark as done
                        </Button>
                        <button
                          type="button"
                          className="text-xs text-app-muted"
                          onClick={() => setConfirm(null)}
                        >
                          Keep in review
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="seo-button-link"
                        onClick={() => setConfirm(fix.id)}
                      >
                        I’ve made this change <Icon name="check" className="size-4" />
                      </button>
                    )}
                  </div>
                )}
                <RuleReference ruleId={fix.ruleId} />
              </article>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export function SeoMonitoringPanel({
  alerts,
  canManage,
  onAcknowledge,
}: {
  alerts: SeoAlert[];
  canManage: boolean;
  onAcknowledge: (id: string) => void;
}) {
  return (
    <div className="seo-panel">
      <SeoSectionHeader
        eyebrow="Activity"
        title="Changes worth a closer look"
        description="Review alerts recorded by your checkups. Marking one as reviewed keeps your team organized; the underlying website issue still needs its own investigation."
      />
      {alerts.length === 0 ? (
        <SeoEmptyState
          kind="monitoring"
          title="No saved notifications"
          description="Your checkups will record supported alerts when they detect important issues or changes. This is not continuous uptime monitoring."
        />
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            <SeoBadge tone="warning">
              {alerts.filter((row) => !row.acknowledgedAt).length} need review
            </SeoBadge>
            <SeoBadge>
              {alerts.filter((row) => !!row.acknowledgedAt).length} reviewed
            </SeoBadge>
          </div>
          <div className="space-y-3">
            {alerts.map((alert) => (
              <article key={alert.id} className="seo-surface p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap gap-2">
                      <SeoSeverityBadge severity={alert.severity} />
                      {alert.acknowledgedAt && (
                        <SeoBadge tone="accent">Reviewed</SeoBadge>
                      )}
                    </div>
                    <h3 className="mt-3 text-sm font-semibold">{alert.title}</h3>
                    <p className="seo-small-copy mt-2">{alert.body}</p>
                    <p className="mt-3 text-[11px] text-app-muted">
                      {new Date(alert.createdAt).toLocaleString()}
                    </p>
                  </div>
                  {canManage && !alert.acknowledgedAt && (
                    <Button kind="secondary" onClick={() => onAcknowledge(alert.id)}>
                      Mark reviewed
                    </Button>
                  )}
                </div>
              </article>
            ))}
          </div>
          <p className="seo-small-copy">Up to 200 saved notifications are loaded.</p>
        </>
      )}
    </div>
  );
}

export function SeoScansPanel({
  scans,
  onTrigger,
  scanning,
  canManage,
}: {
  scans: SeoScanRun[];
  onTrigger: () => void;
  scanning: boolean;
  canManage: boolean;
}) {
  const names: Record<string, string> = {
    ...STATUS_LABEL,
    queued: 'Waiting to start',
    discovering: 'Finding your pages',
    fetching: 'Loading website pages',
    rendering: 'Checking interactive pages',
    evaluating: 'Looking for issues',
    aggregating: 'Preparing your results',
    completed: 'Checkup complete',
    completed_partial: 'Some pages could not be checked',
    cancelled: 'Checkup cancelled',
    failed: 'Checkup could not finish',
  };
  return (
    <div className="seo-panel">
      <SeoSectionHeader
        eyebrow="Activity"
        title="Your website checkup history"
        description="See what was checked, when it was checked, and which pages we could not reach. A completed checkup does not guarantee that every page on the website was discovered."
        action={
          canManage ? (
            <Button onClick={onTrigger} disabled={scanning}>
              <Icon name="refresh" className="mr-2 size-4" />
              {scanning ? 'Checkup running…' : 'Run a new checkup'}
            </Button>
          ) : undefined
        }
      />
      {scans.length === 0 ? (
        <SeoEmptyState
          title="Your first checkup is the starting point"
          description="Run a checkup to discover pages, review common SEO issues, and build a useful history of your improvements."
        />
      ) : (
        <div className="space-y-4">
          {scans.map((scan) => {
            const running = isScanInFlight(scan.status);
            const total = Math.max(
              scan.discoveredCount,
              scan.fetchedCount + scan.failedCount + scan.skippedCount,
            );
            const processed = scan.fetchedCount + scan.failedCount + scan.skippedCount;
            return (
              <article className="seo-surface p-5 sm:p-6" key={scan.id}>
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`grid size-9 place-items-center rounded-xl ${running ? 'bg-app-accent/10 text-app-accent' : scan.status === 'failed' ? 'bg-red-500/10 text-app-danger' : 'bg-app-surface-raised text-app-muted'}`}
                      >
                        <Icon
                          name={
                            running
                              ? 'refresh'
                              : scan.status === 'failed'
                                ? 'alert-circle'
                                : 'check'
                          }
                          className="size-4"
                        />
                      </span>
                      <h3 className="text-sm font-bold">
                        {names[scan.status] ?? scan.status}
                      </h3>
                    </div>
                    <p className="seo-small-copy mt-3">
                      Started {new Date(scan.startedAt ?? scan.queuedAt).toLocaleString()}
                      {scan.startedAt
                        ? ` · ${formatElapsed(scan.startedAt, scan.endedAt)}`
                        : ''}
                    </p>
                  </div>
                  <SeoBadge
                    tone={
                      running
                        ? 'info'
                        : scan.status === 'completed'
                          ? 'accent'
                          : 'warning'
                    }
                  >
                    {running
                      ? 'Updates automatically'
                      : scan.status === 'completed'
                        ? 'Results saved'
                        : 'Review coverage'}
                  </SeoBadge>
                </div>
                {scan.terminationReason && (
                  <div className="mt-4">
                    <SeoHint tone="warning">{scan.terminationReason}</SeoHint>
                  </div>
                )}
                <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {[
                    { value: scan.fetchedCount, label: 'Pages loaded' },
                    { value: scan.skippedCount, label: 'Pages skipped' },
                    { value: scan.failedCount, label: 'Could not load' },
                    { value: scan.findingsCount, label: 'Findings recorded' },
                  ].map((item) => (
                    <div
                      key={item.label}
                      className="rounded-xl bg-app-surface-raised/60 p-3"
                    >
                      <strong className="text-xl font-bold">
                        {item.value.toLocaleString()}
                      </strong>
                      <p className="mt-1 text-[11px] text-app-muted">{item.label}</p>
                    </div>
                  ))}
                </div>
                {running && (
                  <div className="mt-5">
                    <SeoHorizontalBar
                      value={processed}
                      max={total}
                      label={`${processed} of ${total || '?'} discovered URLs processed`}
                      caption="Processing includes pages loaded, skipped, or failed. It is not a health score."
                    />
                  </div>
                )}
                <p className="seo-small-copy mt-4">
                  {total} URLs discovered · {scan.renderedCount} rendered with JavaScript
                  {scan.endedAt
                    ? ` · Finished ${new Date(scan.endedAt).toLocaleString()}`
                    : ''}
                </p>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
