import { useEffect, useState } from 'react';
import { Button, Card, Page } from '../../../ui/components.js';
import { STAGE_LABELS, LIFECYCLE_LABELS, LOSS_REASON_LABELS, formatCurrencyLabel } from '../deals/deals-helpers.js';
import { paiseToRupees } from '../proposals/proposals-helpers.js';
import { getForecast, type ForecastReport } from './api.js';

function currentMonth(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function ReportsPage(): React.JSX.Element {
  const [period, setPeriod] = useState(currentMonth);
  const [report, setReport] = useState<ForecastReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function reload(): Promise<void> {
    setLoading(true);
    try {
      const next = await getForecast(period);
      setReport(next);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load forecast.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period]);

  return (
    <Page
      eyebrow="Sales"
      title="Reports"
      description="Pipeline, wins and losses for the selected period. Scoped by your deals-visibility."
      action={
        <div className="flex items-center gap-2">
          <input
            type="month"
            value={period}
            onChange={(event) => setPeriod(event.target.value)}
            className="rounded-lg border border-app-border bg-app-background px-3 py-2 text-sm"
          />
          <Button kind="secondary" onClick={() => void reload()}>
            Refresh
          </Button>
        </div>
      }
    >
      {error && (
        <p className="mb-4 rounded-lg bg-[#d86b6b]/10 p-3 text-sm text-app-danger" role="alert">
          {error}
        </p>
      )}

      {loading && !report ? (
        <Card>
          <p className="text-sm text-app-muted">Loading…</p>
        </Card>
      ) : report ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <TotalsCard report={report} />
          <FunnelCard report={report} />
          <LifecycleCard report={report} />
          <LossReasonsCard report={report} />
          <Leaderboard report={report} />
        </div>
      ) : null}
    </Page>
  );
}

function TotalsCard({ report }: { report: ForecastReport }): React.JSX.Element {
  const wonMinor = BigInt(report.totals.wonAmountMinor);
  const currency = report.winLeaderboard[0]?.currency ?? 'INR';
  const symbol = formatCurrencyLabel(currency);
  return (
    <Card>
      <h3 className="font-display text-lg font-bold">Period totals</h3>
      <div className="mt-3 grid grid-cols-2 gap-4 text-sm">
        <Metric label="Won" value={String(report.totals.wonCount)} />
        <Metric label="Lost" value={String(report.totals.lostCount)} />
        <Metric label="Open" value={String(report.totals.openCount)} />
        <Metric label="Won amount" value={`${symbol}${paiseToRupees(wonMinor)}`} />
      </div>
    </Card>
  );
}

function FunnelCard({ report }: { report: ForecastReport }): React.JSX.Element {
  const max = Math.max(1, ...report.funnel.map((b) => b.count));
  return (
    <Card>
      <h3 className="font-display text-lg font-bold">Open deals by stage</h3>
      <p className="mt-1 text-xs text-app-muted">Snapshot — not period-filtered.</p>
      <div className="mt-4 space-y-2">
        {report.funnel.map((bucket) => (
          <div key={bucket.stage}>
            <div className="flex justify-between text-xs font-semibold">
              <span>{STAGE_LABELS[bucket.stage]}</span>
              <span>{bucket.count}</span>
            </div>
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-app-background">
              <div
                className="h-full bg-app-accent"
                style={{ width: `${(bucket.count / max) * 100}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function LifecycleCard({ report }: { report: ForecastReport }): React.JSX.Element {
  return (
    <Card>
      <h3 className="font-display text-lg font-bold">Lifecycle this period</h3>
      <p className="mt-1 text-xs text-app-muted">
        Counts a deal when its terminal event lands in the period (open deals use created_at).
      </p>
      <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
        {report.lifecycle.map((bucket) => (
          <div key={bucket.lifecycleStatus} className="rounded-lg bg-app-background p-3">
            <p className="text-xs font-semibold uppercase text-app-muted">
              {LIFECYCLE_LABELS[bucket.lifecycleStatus]}
            </p>
            <p className="mt-1 font-display text-2xl font-bold">{bucket.count}</p>
          </div>
        ))}
      </div>
    </Card>
  );
}

function LossReasonsCard({ report }: { report: ForecastReport }): React.JSX.Element {
  return (
    <Card>
      <h3 className="font-display text-lg font-bold">Why we lost</h3>
      {report.lossReasons.length === 0 ? (
        <p className="mt-2 text-sm text-app-muted">No lost deals in this period.</p>
      ) : (
        <ul className="mt-3 space-y-2 text-sm">
          {report.lossReasons.map((bucket) => (
            <li key={bucket.reason} className="flex justify-between">
              <span>{LOSS_REASON_LABELS[bucket.reason]}</span>
              <span className="font-semibold">{bucket.count}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Leaderboard({ report }: { report: ForecastReport }): React.JSX.Element {
  return (
    <Card className="lg:col-span-2">
      <h3 className="font-display text-lg font-bold">Won amount by closer</h3>
      {report.winLeaderboard.length === 0 ? (
        <p className="mt-2 text-sm text-app-muted">Nobody has recorded a win this period yet.</p>
      ) : (
        <table className="mt-3 w-full text-sm">
          <thead>
            <tr className="text-left text-xs font-semibold uppercase text-app-muted">
              <th className="pb-2">Closer</th>
              <th className="pb-2 text-right">Wins</th>
              <th className="pb-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-app-border">
            {report.winLeaderboard.map((entry) => (
              <tr key={entry.responsibleCloserId}>
                <td className="py-2">{entry.responsibleCloserName ?? '—'}</td>
                <td className="py-2 text-right">{entry.wonCount}</td>
                <td className="py-2 text-right">
                  {formatCurrencyLabel(entry.currency)}
                  {paiseToRupees(BigInt(entry.wonAmountMinor))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-app-muted">{label}</p>
      <p className="mt-1 font-display text-2xl font-bold">{value}</p>
    </div>
  );
}
