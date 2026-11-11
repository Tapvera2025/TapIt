import { useEffect, useMemo, useState } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
  type ChartOptions,
} from 'chart.js';
import { Line } from 'react-chartjs-2';
import { Button, Card, Notice } from '../ui/index.js';
import {
  getClientSearchConsolePerformance,
  inspectClientSearchConsoleUrl,
  listClientSearchConsoleProperties,
} from './api.js';
import { dateInZone } from './presentation.js';
import type {
  SocialGoogleIndexInspection,
  SocialSearchConsoleDimensionRow,
  SocialSearchConsoleMetricSet,
  SocialSearchConsolePerformance,
  SocialSearchConsoleProperty,
} from './types.js';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Filler, Tooltip);

type ChartMetric = 'clicks' | 'impressions' | 'ctr' | 'avgPosition';
type ReportTab = 'queries' | 'pages' | 'countries' | 'devices';

const METRIC_LABELS: Record<ChartMetric, string> = {
  clicks: 'Clicks', impressions: 'Impressions', ctr: 'Average CTR', avgPosition: 'Average position',
};
const REPORT_TABS: { id: ReportTab; label: string }[] = [
  { id: 'queries', label: 'Queries' },
  { id: 'pages', label: 'Pages' },
  { id: 'countries', label: 'Countries' },
  { id: 'devices', label: 'Devices' },
];

function dateMinusDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() - days);
  return value.toISOString().slice(0, 10);
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(value);
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function formatPosition(value: number | null): string {
  return value === null ? '—' : value.toFixed(1);
}

function rowMainText(row: SocialSearchConsoleDimensionRow, tab: ReportTab): string {
  if (tab === 'devices') return row.value.toLowerCase().replace(/^./, (letter) => letter.toUpperCase());
  if (tab === 'countries') return row.value.toUpperCase();
  return row.value;
}

function useSearchConsoleProperties(clientId: string) {
  const [properties, setProperties] = useState<SocialSearchConsoleProperty[] | null>(null);
  const [propertyWarning, setPropertyWarning] = useState('');
  const [propertyError, setPropertyError] = useState('');
  const [propertyUrl, setPropertyUrl] = useState('');

  useEffect(() => {
    let current = true;
    setProperties(null);
    setPropertyError('');
    void listClientSearchConsoleProperties(clientId)
      .then((result) => {
        if (!current) return;
        setProperties(result.properties);
        setPropertyWarning(result.warning ?? '');
        setPropertyUrl((selected) => result.properties.some((item) => item.propertyUrl === selected)
          ? selected
          : result.properties.find((item) => item.status === 'connected')?.propertyUrl ?? result.properties[0]?.propertyUrl ?? '');
      })
      .catch((error: unknown) => {
        if (current) setPropertyError(error instanceof Error ? error.message : 'Search Console properties could not be loaded.');
      });
    return () => { current = false; };
  }, [clientId]);

  return { properties, propertyUrl, setPropertyUrl, propertyWarning, propertyError };
}

export function SearchConsolePerformance({
  clientId,
  timezone,
  canManageIntegrations,
  onManageConnections,
}: {
  clientId: string;
  timezone: string;
  canManageIntegrations: boolean;
  onManageConnections: () => void;
}): React.JSX.Element {
  const today = dateInZone(new Date().toISOString(), timezone);
  const initialPeriod = { from: dateMinusDays(today, 27), to: today };
  const [draft, setDraft] = useState(initialPeriod);
  const [period, setPeriod] = useState(initialPeriod);
  const { properties, propertyUrl, setPropertyUrl, propertyWarning, propertyError } = useSearchConsoleProperties(clientId);
  const [data, setData] = useState<SocialSearchConsolePerformance | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [chartMetric, setChartMetric] = useState<ChartMetric>('clicks');
  const [reportTab, setReportTab] = useState<ReportTab>('queries');
  const [search, setSearch] = useState('');
  const [inspectionUrl, setInspectionUrl] = useState('');
  const [inspection, setInspection] = useState<SocialGoogleIndexInspection | null>(null);
  const [inspectionLoading, setInspectionLoading] = useState(false);
  const [inspectionError, setInspectionError] = useState('');

  const selectedProperty = properties?.find((property) => property.propertyUrl === propertyUrl) ?? null;

  useEffect(() => {
    let current = true;
    if (!propertyUrl || selectedProperty?.status !== 'connected') {
      setData(null);
      setLoading(false);
      setError('');
      return () => { current = false; };
    }
    setLoading(true);
    setError('');
    setData(null);
    void getClientSearchConsolePerformance(clientId, { propertyUrl, ...period })
      .then((result) => { if (current) setData(result); })
      .catch((cause: unknown) => {
        if (current) setError(cause instanceof Error ? cause.message : 'Google Search performance could not be loaded.');
      })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [clientId, period, propertyUrl, selectedProperty?.status]);

  const rows = useMemo(() => {
    if (!data) return [];
    const list = data[reportTab];
    const term = search.trim().toLocaleLowerCase();
    return term ? list.filter((row) => row.value.toLocaleLowerCase().includes(term)) : list;
  }, [data, reportTab, search]);

  const chartOptions: ChartOptions<'line'> = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (item) => {
            const value = Number(item.raw ?? 0);
            const formatted = chartMetric === 'ctr' ? `${value.toFixed(2)}%` : chartMetric === 'avgPosition' ? value.toFixed(1) : formatNumber(value);
            return `${METRIC_LABELS[chartMetric]}: ${formatted}`;
          },
        },
      },
    },
    scales: {
      x: { grid: { display: false }, ticks: { color: '#718096', maxTicksLimit: 8, maxRotation: 0, font: { size: 10 } } },
      y: {
        beginAtZero: chartMetric !== 'avgPosition',
        reverse: false,
        ticks: { color: '#718096', maxTicksLimit: 5, precision: chartMetric === 'avgPosition' ? 1 : 0, font: { size: 10 } },
        grid: { color: 'rgba(148,163,184,.2)' },
      },
    },
  }), [chartMetric]);

  const metricValue = (metric: ChartMetric, totals: SocialSearchConsoleMetricSet | null): string => {
    if (!totals) return '—';
    if (metric === 'clicks' || metric === 'impressions') return formatNumber(totals[metric]);
    if (metric === 'ctr') return formatPercent(totals.ctr);
    return formatPosition(totals.avgPosition);
  };

  function applyPreset(days: number): void {
    const next = { from: dateMinusDays(today, days - 1), to: today };
    setDraft(next);
    setPeriod(next);
  }

  async function inspect(): Promise<void> {
    if (!propertyUrl || !inspectionUrl.trim()) return;
    setInspectionLoading(true);
    setInspectionError('');
    setInspection(null);
    try {
      const result = await inspectClientSearchConsoleUrl(clientId, { propertyUrl, inspectionUrl: inspectionUrl.trim() });
      setInspection(result);
    } catch (cause) {
      setInspectionError(cause instanceof Error ? cause.message : 'Google could not inspect this URL.');
    } finally {
      setInspectionLoading(false);
    }
  }

  return (
    <div className="space-y-5">
      <Card className="overflow-hidden border-app-border/70 bg-gradient-to-br from-orange-50/70 via-app-surface to-sky-50/50 dark:from-orange-950/15 dark:via-app-surface dark:to-sky-950/15">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-2xl">
            <p className="text-[11px] font-bold uppercase tracking-[.18em] text-app-accent">Google Search Console</p>
            <h2 className="mt-2 font-display text-2xl font-bold tracking-tight text-app-foreground sm:text-3xl">Search performance</h2>
            <p className="mt-2 text-sm leading-6 text-app-muted">Organic search results for this client, reported directly by Google.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:min-w-[480px]">
            <label className="grid gap-1.5 text-xs font-semibold text-app-muted">
              Search Console property
              <select value={propertyUrl} onChange={(event) => { setPropertyUrl(event.target.value); setInspection(null); setInspectionError(''); }} disabled={!properties?.length} className="min-w-0 rounded-xl border border-app-border bg-app-surface px-3 py-2.5 text-sm font-medium text-app-foreground outline-none focus:border-app-accent">
                {(properties ?? []).map((property) => <option key={property.propertyUrl} value={property.propertyUrl}>{property.propertyUrl}{property.status === 'reconnect_required' ? ' · reconnect required' : ''}</option>)}
              </select>
            </label>
            <div className="flex flex-wrap items-end gap-2">
              {[7, 28, 90, 180].map((days) => (
                <button key={days} type="button" onClick={() => applyPreset(days)} aria-pressed={period.from === dateMinusDays(today, days - 1) && period.to === today} className={`rounded-full border px-3 py-2 text-xs font-semibold transition ${period.from === dateMinusDays(today, days - 1) && period.to === today ? 'border-app-accent bg-app-accent text-white' : 'border-app-border bg-app-surface/80 text-app-muted hover:border-app-accent/50 hover:text-app-accent'}`}>
                  {days === 90 ? '3 months' : days === 180 ? '6 months' : `${days} days`}
                </button>
              ))}
            </div>
          </div>
        </div>
        <form onSubmit={(event) => { event.preventDefault(); if (draft.from > draft.to) { setError('The start date must be before the end date.'); return; } setError(''); setPeriod({ ...draft }); }} className="mt-5 flex flex-wrap items-end gap-3 border-t border-app-border/60 pt-4">
          <label className="grid gap-1 text-[11px] font-semibold text-app-muted">From<input type="date" value={draft.from} required onChange={(event) => setDraft((value) => ({ ...value, from: event.target.value }))} className="rounded-lg border border-app-border bg-app-surface px-2.5 py-2 text-xs text-app-foreground" /></label>
          <label className="grid gap-1 text-[11px] font-semibold text-app-muted">To<input type="date" value={draft.to} required onChange={(event) => setDraft((value) => ({ ...value, to: event.target.value }))} className="rounded-lg border border-app-border bg-app-surface px-2.5 py-2 text-xs text-app-foreground" /></label>
          <Button type="submit" kind="secondary" disabled={loading}>Apply dates</Button>
          {data && <span className="ml-auto text-[11px] text-app-muted">Google data through {data.latestDataDate ?? 'no returned dates'} · fetched {new Date(data.fetchedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', timeZone: timezone })}</span>}
        </form>
      </Card>

      {propertyError && <Notice error>{propertyError}</Notice>}
      {propertyWarning && <Notice>{propertyWarning}</Notice>}
      {properties && properties.length === 0 && (
        <Card className="border-dashed">
          <p className="text-sm font-semibold">No Search Console property is assigned to this client.</p>
          <p className="mt-1 text-sm text-app-muted">A company integration admin can connect Google under Company connections and assign this client’s Search Console property.</p>
          {canManageIntegrations && <Button kind="secondary" className="mt-4" onClick={onManageConnections}>Open company connections</Button>}
        </Card>
      )}
      {selectedProperty?.status === 'reconnect_required' && <Notice error>The Google login for this property needs to be reconnected under Company connections before Search Console data can be read.</Notice>}
      {error && <Notice error>{error}</Notice>}

      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 4 }, (_, index) => <div key={index} className="h-28 animate-pulse rounded-2xl bg-app-border/40" />)}</div>
      ) : data && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {(['clicks', 'impressions', 'ctr', 'avgPosition'] as const).map((metric) => (
              <button key={metric} type="button" onClick={() => setChartMetric(metric)} aria-pressed={chartMetric === metric} className={`rounded-2xl border p-4 text-left shadow-sm transition ${chartMetric === metric ? 'border-app-accent bg-orange-50/65 ring-1 ring-app-accent/20 dark:bg-orange-950/15' : 'border-app-border bg-app-surface hover:border-app-accent/40'}`}>
                <span className="text-xs font-semibold text-app-muted">{METRIC_LABELS[metric]}</span>
                <span className="mt-3 block text-2xl font-bold tabular-nums tracking-tight text-app-foreground">{metricValue(metric, data.totals)}</span>
                <span className="mt-1 block text-[10px] text-app-muted">{metric === 'avgPosition' ? 'Lower is better · period average' : 'Google web search'}</span>
              </button>
            ))}
          </div>

          <Card>
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div><h3 className="font-semibold">Performance over time</h3><p className="mt-1 text-xs text-app-muted">Daily Google Search totals for {data.startDate} to {data.endDate}.</p></div>
              <span className="rounded-full bg-app-surface-raised px-3 py-1.5 text-[11px] font-semibold text-app-muted">{METRIC_LABELS[chartMetric]}</span>
            </div>
            {data.daily.length ? (
              <div className="h-64 sm:h-72">
                <Line role="img" aria-label={`Daily ${METRIC_LABELS[chartMetric]} from Google Search`} options={chartOptions} data={{
                  labels: data.daily.map((row) => row.date),
                  datasets: [{
                    label: METRIC_LABELS[chartMetric],
                    data: data.daily.map((row) => chartMetric === 'ctr' ? row.ctr * 100 : chartMetric === 'avgPosition' ? row.avgPosition ?? 0 : row[chartMetric]),
                    borderColor: chartMetric === 'impressions' ? '#0ea5e9' : '#f97316',
                    backgroundColor: chartMetric === 'impressions' ? 'rgba(14,165,233,.10)' : 'rgba(249,115,22,.10)',
                    borderWidth: 2.5,
                    pointRadius: data.daily.length <= 2 ? 3 : 0,
                    pointHoverRadius: 4,
                    tension: 0.25,
                    fill: true,
                  }],
                }} />
              </div>
            ) : <div className="grid min-h-52 place-items-center text-center text-sm text-app-muted">No daily Search Console rows were returned for these dates.</div>}
          </Card>

          <Card className="overflow-hidden p-0">
            <div className="flex flex-col gap-3 border-b border-app-border p-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
              <div><h3 className="font-semibold">Search results</h3><p className="mt-1 text-xs text-app-muted">Top Google rows for the selected dimension.</p></div>
              <label className="text-[11px] text-app-muted">Filter rows<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search table" className="ml-2 w-40 rounded-lg border border-app-border bg-app-background px-2.5 py-1.5 text-xs text-app-foreground" /></label>
            </div>
            <div className="flex gap-1 overflow-x-auto border-b border-app-border px-3 pt-2" role="tablist" aria-label="Search Console dimensions">
              {REPORT_TABS.map((tab) => <button key={tab.id} role="tab" aria-selected={reportTab === tab.id} type="button" onClick={() => { setReportTab(tab.id); setSearch(''); }} className={`shrink-0 border-b-2 px-3 py-2 text-xs font-semibold ${reportTab === tab.id ? 'border-app-accent text-app-accent' : 'border-transparent text-app-muted hover:text-app-foreground'}`}>{tab.label}</button>)}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[690px] text-left text-xs">
                <thead className="bg-app-surface-raised/60 text-[10px] uppercase tracking-wide text-app-muted"><tr><th className="px-4 py-3">{REPORT_TABS.find((tab) => tab.id === reportTab)?.label}</th><th className="px-4 py-3 text-right">Clicks</th><th className="px-4 py-3 text-right">Impressions</th><th className="px-4 py-3 text-right">CTR</th><th className="px-4 py-3 text-right">Position</th></tr></thead>
                <tbody className="divide-y divide-app-border/70">
                  {rows.slice(0, 100).map((row) => <tr key={row.value} className="hover:bg-app-surface-raised/40"><td className="max-w-[440px] truncate px-4 py-3 font-medium text-app-foreground" title={row.value}>{rowMainText(row, reportTab)}</td><td className="px-4 py-3 text-right tabular-nums">{formatNumber(row.clicks)}</td><td className="px-4 py-3 text-right tabular-nums">{formatNumber(row.impressions)}</td><td className="px-4 py-3 text-right tabular-nums">{formatPercent(row.ctr)}</td><td className="px-4 py-3 text-right tabular-nums">{formatPosition(row.avgPosition)}</td></tr>)}
                  {rows.length === 0 && <tr><td colSpan={5} className="px-4 py-12 text-center text-sm text-app-muted">No Search Console rows match this filter.</td></tr>}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-app-border px-4 py-3 text-[10px] text-app-muted">
              <span>Showing {Math.min(rows.length, 100)} of {formatNumber(rows.length)} returned rows.</span>
              {data.rowLimitHit[reportTab] && <span>Google returned the first 1,000 rows; this dimension may be truncated.</span>}
            </div>
          </Card>

          <UrlInspectionCard
            propertyUrl={propertyUrl}
            inspectionUrl={inspectionUrl}
            setInspectionUrl={setInspectionUrl}
            inspection={inspection}
            loading={inspectionLoading}
            error={inspectionError}
            onInspect={() => void inspect()}
          />
        </>
      )}
      {data && <p className="px-1 text-[10px] leading-5 text-app-muted">Performance numbers are returned directly from Google Search Console. Google may omit anonymized or low volume query rows; the tables show up to 1,000 rows per dimension. Average position is a period average, not a live rank.</p>}
    </div>
  );
}

function verdictTone(value?: string): string {
  if (value === 'PASS' || value === 'ALLOWED' || value === 'INDEXING_ALLOWED' || value === 'SUCCESSFUL') return 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
  if (value === 'FAIL' || value === 'DISALLOWED' || value?.startsWith('BLOCKED') || value === 'NOT_FOUND' || value === 'SERVER_ERROR') return 'bg-rose-500/10 text-rose-700 dark:text-rose-300';
  return 'bg-slate-500/10 text-app-muted';
}

function StatePill({ label, value }: { label: string; value: string | undefined }): React.JSX.Element {
  return <div className="rounded-xl border border-app-border/70 bg-app-background/65 p-3"><p className="text-[10px] font-semibold uppercase tracking-wide text-app-muted">{label}</p><span className={`mt-2 inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold ${verdictTone(value)}`}>{value?.replaceAll('_', ' ') ?? 'Not returned'}</span></div>;
}

function UrlInspectionCard({
  propertyUrl,
  inspectionUrl,
  setInspectionUrl,
  inspection,
  loading,
  error,
  onInspect,
}: {
  propertyUrl: string;
  inspectionUrl: string;
  setInspectionUrl: (value: string) => void;
  inspection: SocialGoogleIndexInspection | null;
  loading: boolean;
  error: string;
  onInspect: () => void;
}): React.JSX.Element {
  const index = inspection?.indexStatusResult;
  const richResultIssues = (inspection?.richResultsResult?.detectedItems ?? []).flatMap((group) =>
    (group.items ?? []).flatMap((item) => (item.issues ?? []).map((issue) => ({
      ...issue,
      message: `${group.richResultType ?? 'Structured data'}${item.name ? ` · ${item.name}` : ''}: ${issue.message ?? issue.issueMessage ?? issue.issueType ?? 'Issue reported'}`,
    }))),
  );
  return (
    <Card>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div><p className="text-[10px] font-bold uppercase tracking-[.16em] text-app-accent">URL inspection</p><h3 className="mt-1 font-display text-xl font-bold">Google indexing verdict</h3><p className="mt-1 max-w-2xl text-xs leading-5 text-app-muted">Inspect a page in the selected property. Google reports the version currently in its index, not a live test.</p></div>
        <form onSubmit={(event) => { event.preventDefault(); onInspect(); }} className="flex w-full flex-col gap-2 sm:flex-row lg:max-w-2xl">
          <input type="url" value={inspectionUrl} onChange={(event) => setInspectionUrl(event.target.value)} placeholder="https://example.com/page" required aria-label="URL to inspect" className="min-w-0 flex-1 rounded-xl border border-app-border bg-app-background px-3 py-2.5 text-sm text-app-foreground outline-none focus:border-app-accent" />
          <Button type="submit" disabled={loading || !propertyUrl}>{loading ? 'Inspecting…' : 'Inspect URL'}</Button>
        </form>
      </div>
      {error && <Notice error>{error}</Notice>}
      {inspection && (
        <div className="mt-5 space-y-4">
          <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-app-border/70 bg-app-surface-raised/50 p-4">
            <span className={`rounded-full px-3 py-1.5 text-xs font-bold ${verdictTone(index?.verdict)}`}>{index?.verdict?.replaceAll('_', ' ') ?? 'Verdict unavailable'}</span>
            <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold" title={inspection.inspectionUrl}>{inspection.inspectionUrl}</p><p className="mt-1 text-[10px] text-app-muted">Coverage: {index?.coverageState ?? 'Not returned'} · Inspected {new Date(inspection.inspectedAt).toLocaleString()}</p></div>
            {inspection.inspectionResultLink && <a href={inspection.inspectionResultLink} target="_blank" rel="noreferrer" className="shrink-0 rounded-full border border-app-border px-3 py-1.5 text-[10px] font-semibold text-app-muted hover:text-app-accent">Open in Search Console ↗</a>}
          </div>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <StatePill label="Indexing status" value={index?.indexingState} />
            <StatePill label="Robots.txt" value={index?.robotsTxtState} />
            <StatePill label="Page fetch" value={index?.pageFetchState} />
            <StatePill label="Google verdict" value={index?.verdict} />
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            <div className="rounded-2xl border border-app-border/70 p-4">
              <h4 className="text-sm font-semibold">Crawl and canonical</h4>
              <dl className="mt-3 space-y-3 text-xs">
                <InspectionValue label="Last crawl" value={index?.lastCrawlTime ? new Date(index.lastCrawlTime).toLocaleString() : null} />
                <InspectionValue label="Crawled as" value={index?.crawledAs?.replaceAll('_', ' ')} />
                <InspectionValue label="Google-selected canonical" value={index?.googleCanonical} />
                <InspectionValue label="User-declared canonical" value={index?.userCanonical} />
              </dl>
            </div>
            <div className="rounded-2xl border border-app-border/70 p-4">
              <h4 className="text-sm font-semibold">Sitemaps and referring pages</h4>
              <ListOrEmpty label="Sitemaps" items={index?.sitemap ?? []} />
              <ListOrEmpty label="Referring URLs" items={index?.referringUrls ?? []} />
            </div>
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            <InspectionEnhancement title="Mobile usability" verdict={inspection.mobileUsabilityResult?.verdict} issues={inspection.mobileUsabilityResult?.issues ?? []} absent="Google did not return mobile usability data for this page." footnote="This legacy Search Console field may be omitted." />
            <InspectionEnhancement title="Rich results" verdict={inspection.richResultsResult?.verdict} issues={richResultIssues} absent="No eligible rich-result items were found for this page." footnote={`${inspection.richResultsResult?.detectedItems?.length ?? 0} structured-data type${inspection.richResultsResult?.detectedItems?.length === 1 ? '' : 's'} detected.`} />
          </div>
          {inspection.ampResult && <InspectionEnhancement title="AMP" verdict={inspection.ampResult.verdict} issues={inspection.ampResult.issues ?? []} absent="No AMP result details were returned." footnote={inspection.ampResult.ampUrl ?? 'AMP version'} />}
        </div>
      )}
      {!inspection && !loading && !error && <div className="mt-5 rounded-2xl border border-dashed border-app-border p-6 text-center text-xs text-app-muted">Enter a URL in this Search Console property to see Google’s indexed-page report.</div>}
    </Card>
  );
}

function InspectionValue({ label, value }: { label: string; value: string | null | undefined }): React.JSX.Element {
  return <div className="grid gap-1 sm:grid-cols-[190px_minmax(0,1fr)]"><dt className="font-semibold text-app-muted">{label}</dt><dd className="min-w-0 break-all font-medium text-app-foreground">{value || 'Not returned'}</dd></div>;
}

function ListOrEmpty({ label, items }: { label: string; items: string[] }): React.JSX.Element {
  return <div className="mt-3"><p className="text-[10px] font-semibold uppercase tracking-wide text-app-muted">{label}</p>{items.length ? <ul className="mt-1 space-y-1">{items.slice(0, 5).map((item) => <li key={item} className="truncate text-xs" title={item}>{item}</li>)}</ul> : <p className="mt-1 text-xs text-app-muted">Not returned</p>}</div>;
}

function InspectionEnhancement({ title, verdict, issues, absent, footnote }: { title: string; verdict: string | undefined; issues: Array<{ message?: string; issueMessage?: string; issueType?: string; severity?: string }>; absent: string; footnote: string }): React.JSX.Element {
  return <div className="rounded-2xl border border-app-border/70 p-4">
    <div className="flex items-start justify-between gap-2"><div><h4 className="text-sm font-semibold">{title}</h4><p className="mt-1 text-[10px] text-app-muted">{footnote}</p></div>{verdict && <span className={`shrink-0 rounded-full px-2.5 py-1 text-[9px] font-bold ${verdictTone(verdict)}`}>{verdict.replaceAll('_', ' ')}</span>}</div>
    {issues.length ? <ul className="mt-3 space-y-2">{issues.map((issue, index) => <li key={`${issue.issueType ?? issue.issueMessage ?? issue.message}-${index}`} className="rounded-xl bg-rose-500/[.06] px-3 py-2 text-xs"><span className="font-semibold">{issue.message ?? issue.issueMessage ?? issue.issueType ?? 'Issue reported'}</span>{issue.severity && <span className="ml-2 text-[10px] text-app-muted">{issue.severity.toLowerCase()}</span>}</li>)}</ul> : <p className="mt-3 text-xs text-app-muted">{title === 'Rich results' && verdict === 'PASS' ? 'No rich result issues reported.' : absent}</p>}
  </div>;
}
