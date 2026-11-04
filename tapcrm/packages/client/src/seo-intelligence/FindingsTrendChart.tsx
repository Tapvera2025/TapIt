import { useEffect, useId, useMemo, useState } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
  type ChartData,
  type ChartOptions,
} from 'chart.js';
import { Line } from 'react-chartjs-2';
import { useTheme } from '../theme/ThemeContext.js';
import { Button, Card } from '../ui/index.js';
import { getSeoFindingsTrend } from './api.js';
import {
  findingsTrendRows,
  formatTrendDay,
  TREND_SEVERITIES,
} from './findings-trend-model.js';
import type { SeoFindingsTrendPoint, SeoSeverity } from './types.js';
import { SEVERITY_LABELS } from './SeoUi.js';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Filler, Tooltip);

const SEVERITY_COLOR: Record<SeoSeverity, { border: string; fill: string }> = {
  critical: { border: '#ef4444', fill: 'rgba(239, 68, 68, 0.40)' },
  high: { border: '#f97316', fill: 'rgba(249, 115, 22, 0.36)' },
  moderate: { border: '#eab308', fill: 'rgba(234, 179, 8, 0.32)' },
  low: { border: '#3b82f6', fill: 'rgba(59, 130, 246, 0.30)' },
  informational: { border: '#94a3b8', fill: 'rgba(148, 163, 184, 0.26)' },
};

interface TrendState {
  requestKey: string;
  points: SeoFindingsTrendPoint[];
  loading: boolean;
  error: string;
}

export function FindingsTrendChart({
  siteId,
  days = 30,
  refreshKey = '',
}: {
  siteId: string;
  days?: number;
  refreshKey?: string;
}) {
  const { resolvedTheme } = useTheme();
  const headingId = useId();
  const summaryId = useId();
  const requestKey = `${siteId}:${days}`;
  const [state, setState] = useState<TrendState>({
    requestKey,
    points: [],
    loading: true,
    error: '',
  });
  const [retry, setRetry] = useState(0);
  const [hidden, setHidden] = useState<SeoSeverity[]>([]);

  useEffect(() => {
    let cancelled = false;
    setState((previous) => ({
      requestKey,
      points: previous.requestKey === requestKey ? previous.points : [],
      loading: true,
      error: '',
    }));
    void getSeoFindingsTrend(siteId, days)
      .then((points) => {
        if (!cancelled) setState({ requestKey, points, loading: false, error: '' });
      })
      .catch((error: unknown) => {
        if (!cancelled)
          setState((previous) => ({
            ...previous,
            loading: false,
            error:
              error instanceof Error
                ? error.message
                : 'The findings trend could not be loaded.',
          }));
      });
    return () => {
      cancelled = true;
    };
  }, [siteId, days, requestKey, refreshKey, retry]);

  const loading = state.requestKey !== requestKey || state.loading;
  const error = state.requestKey === requestKey ? state.error : '';
  const rows = useMemo(
    () => (state.requestKey === requestKey ? findingsTrendRows(state.points) : []),
    [state.requestKey, state.points, requestKey],
  );
  const latest = rows.at(-1);
  const allZero = rows.length > 0 && rows.every((row) => row.total === 0);
  const chartData = useMemo<ChartData<'line'>>(
    () => ({
      labels: rows.map((row) => row.day),
      datasets: TREND_SEVERITIES.map((severity) => ({
        label: severityLabel(severity),
        data: rows.map((row) => row.counts[severity]),
        borderColor: SEVERITY_COLOR[severity].border,
        backgroundColor: SEVERITY_COLOR[severity].fill,
        hidden: hidden.includes(severity),
        fill: 'stack',
        tension: 0,
        pointRadius: rows.length === 1 ? 3 : 0,
        pointHoverRadius: 4,
        borderWidth: 1.5,
      })),
    }),
    [rows, hidden],
  );

  const options = useMemo<ChartOptions<'line'>>(() => {
    const textColor = resolvedTheme === 'dark' ? '#cbd5e1' : '#475569';
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: {
          grid: { display: false },
          ticks: {
            color: textColor,
            autoSkip: true,
            maxTicksLimit: 8,
            maxRotation: 0,
            font: { size: 11 },
            callback: (_value, index) =>
              rows[index] ? formatTrendDay(rows[index].day) : '',
          },
        },
        y: {
          stacked: true,
          beginAtZero: true,
          suggestedMax: allZero ? 1 : undefined,
          grid: { color: resolvedTheme === 'dark' ? '#334155' : '#e2e8f0' },
          ticks: { color: textColor, precision: 0, font: { size: 11 } },
        },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: (items) => (items[0] ? formatTrendDay(items[0].label, true) : ''),
            footer: (items) =>
              `Visible total: ${items.reduce((sum, item) => sum + (item.parsed.y ?? 0), 0)}`,
          },
        },
      },
    };
  }, [rows, allZero, resolvedTheme]);

  return (
    <Card className="seo-trend-card min-w-0">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id={headingId} className="text-sm font-medium">
            Are your website issues improving?
          </h2>
          <p id={summaryId} className="mt-1 text-xs text-app-text-muted">
            Last {days} days · Estimated unresolved findings
            {latest ? ` · Latest: ${latest.total.toLocaleString()}` : ''}
          </p>
        </div>
        {loading && (
          <p role="status" className="text-xs text-app-text-muted">
            {rows.length ? 'Updating trend…' : 'Loading trend…'}
          </p>
        )}
      </div>
      {error && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <p role="alert" className="text-sm text-app-danger">
            {error}
            {rows.length > 0 ? ' Showing the last loaded trend.' : ''}
          </p>
          <Button kind="secondary" onClick={() => setRetry((value) => value + 1)}>
            Retry trend
          </Button>
        </div>
      )}
      {rows.length > 0 ? (
        <>
          {allZero && (
            <p className="mb-3 text-sm text-app-text-muted">
              No open findings recorded in this period.
            </p>
          )}
          <div className="relative h-56 min-w-0 sm:h-64">
            <Line
              data={chartData}
              options={options}
              role="img"
              aria-labelledby={headingId}
              aria-describedby={summaryId}
            />
          </div>
          <div
            role="group"
            className="mt-3 flex flex-wrap justify-center gap-2"
            aria-label="Toggle severity series"
          >
            {TREND_SEVERITIES.map((severity) => (
              <button
                type="button"
                key={severity}
                aria-pressed={!hidden.includes(severity)}
                onClick={() =>
                  setHidden((current) =>
                    current.includes(severity)
                      ? current.filter((value) => value !== severity)
                      : [...current, severity],
                  )
                }
                className={`inline-flex items-center gap-1.5 rounded-md border border-app-border px-2 py-1 text-xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent ${hidden.includes(severity) ? 'text-app-text-muted line-through' : 'text-app-text'}`}
              >
                <span
                  aria-hidden="true"
                  className="size-2.5 rounded-sm"
                  style={{ backgroundColor: SEVERITY_COLOR[severity].border }}
                />
                {severityLabel(severity)}
              </button>
            ))}
          </div>
          <details className="mt-4 text-xs text-app-text-muted">
            <summary className="w-fit cursor-pointer rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent">
              View daily trend data
            </summary>
            <div className="mt-3 max-h-64 overflow-auto">
              <table className="w-full text-left tabular-nums">
                <caption className="sr-only">
                  Daily open findings by severity in UTC. All severities are included.
                </caption>
                <thead>
                  <tr>
                    <th scope="col" className="p-2">
                      Date (UTC)
                    </th>
                    {TREND_SEVERITIES.map((severity) => (
                      <th scope="col" key={severity} className="p-2">
                        {severityLabel(severity)}
                      </th>
                    ))}
                    <th scope="col" className="p-2">
                      Total
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.day} className="border-t border-app-border">
                      <th scope="row" className="whitespace-nowrap p-2 font-normal">
                        {row.day}
                      </th>
                      {TREND_SEVERITIES.map((severity) => (
                        <td key={severity} className="p-2">
                          {row.counts[severity]}
                        </td>
                      ))}
                      <td className="p-2 font-medium">{row.total}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
          <p className="mt-3 text-xs text-app-text-muted">
            Lower totals can mean fewer unresolved findings. These estimates use UTC dates
            and the latest resolution, so earlier reopen cycles and priority changes are
            not retained.
          </p>
        </>
      ) : !loading && !error ? (
        <p className="text-sm text-app-text-muted">
          No trend data is available yet. Run an audit scan to start tracking findings.
        </p>
      ) : null}
    </Card>
  );
}

function severityLabel(severity: SeoSeverity): string {
  return SEVERITY_LABELS[severity];
}
