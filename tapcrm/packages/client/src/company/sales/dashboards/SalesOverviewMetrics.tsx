import { useState, type ReactNode } from 'react';
import { Card, Icon, Skeleton } from '../../../ui/index.js';
import { ErrorToast } from '../../../ui/ErrorToast.js';
import type { SalesOverviewMetrics } from './dashboard-api.js';

const STAGE_COLORS = {
  primary: 'var(--app-accent)',
  secondary: 'color-mix(in srgb, var(--app-accent) 82%, var(--app-foreground))',
  tertiary: 'color-mix(in srgb, var(--app-accent) 64%, var(--app-foreground))',
  subtle: 'color-mix(in srgb, var(--app-accent) 44%, var(--app-foreground))',
  quiet: 'color-mix(in srgb, var(--app-accent) 26%, var(--app-foreground))',
  muted: 'var(--app-muted)',
} as const;

const STAGES = [
  { label: 'New', statuses: ['new', 'assigned'], color: STAGE_COLORS.primary },
  { label: 'Contacted', statuses: ['contacted'], color: STAGE_COLORS.secondary },
  { label: 'Discovery', statuses: ['discovery'], color: STAGE_COLORS.tertiary },
  { label: 'Proposal', statuses: ['proposal_sent'], color: STAGE_COLORS.subtle },
  { label: 'Follow-up', statuses: ['follow_up', 'callback_scheduled'], color: STAGE_COLORS.quiet },
  { label: 'Nurture', statuses: ['nurture'], color: STAGE_COLORS.muted },
] as const;

const weekday = new Intl.DateTimeFormat(undefined, { weekday: 'short', timeZone: 'UTC' });
const fullDate = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' });

export function OverviewHeading({ title, info, action }: {
  title: string;
  info?: string;
  action?: ReactNode;
}): React.JSX.Element {
  return (
    <header className="sales-overview-card-header">
      <div className="flex min-w-0 items-center gap-2">
        <h2 className="font-display text-lg font-bold tracking-tight sm:text-xl">{title}</h2>
        {info && (
          <details className="sales-overview-info">
            <summary aria-label={`About ${title}`}><Icon name="info" className="size-4" /></summary>
            <p>{info}</p>
          </details>
        )}
      </div>
      {action}
    </header>
  );
}

export function OverviewLink({ children, onClick }: { children: ReactNode; onClick: () => void }): React.JSX.Element {
  return <button type="button" onClick={onClick} className="sales-overview-link">{children}</button>;
}

function statusTotal(rows: SalesOverviewMetrics['statuses'], statuses: readonly string[], excludeStalled = false): number {
  return rows.reduce((sum, row) => (
    statuses.includes(row.status) ? sum + row.count - (excludeStalled ? row.stalled : 0) : sum
  ), 0);
}

export function SalesOverviewMetricCards({ metrics, error, onNavigate, leaderboard }: {
  metrics: SalesOverviewMetrics | null;
  error: string | null;
  onNavigate: (path: string) => void;
  leaderboard?: ReactNode;
}): React.JSX.Element {
  const [byStage, setByStage] = useState(false);
  const statuses = metrics?.statuses ?? [];
  const total = statuses.reduce((sum, row) => sum + row.count, 0);
  const stageValues = STAGES.map((stage) => ({ ...stage, count: statusTotal(statuses, stage.statuses) }));
  const visibleStages = stageValues.filter((stage, index) => index < 4 || stage.count > 0);
  const nurture = statuses.find((row) => row.status === 'nurture');
  const inactive = statuses.reduce((sum, row) => sum + row.stalled, 0) + (nurture?.count ?? 0) - (nurture?.stalled ?? 0);
  const health = byStage ? stageValues.filter((stage) => stage.count > 0) : [
    { label: 'New & contacted', count: statusTotal(statuses, ['new', 'assigned', 'contacted'], true), color: STAGE_COLORS.primary },
    { label: 'In discovery', count: statusTotal(statuses, ['discovery'], true), color: STAGE_COLORS.tertiary },
    { label: 'Proposal & follow-up', count: statusTotal(statuses, ['proposal_sent', 'follow_up', 'callback_scheduled'], true), color: STAGE_COLORS.subtle },
    { label: 'Inactive', count: inactive, color: 'var(--app-danger)' },
  ];
  const loading = !metrics && !error;

  return (
    <div className="sales-overview-metrics-layout">
      {error && <ErrorToast message={error} />}
      <div className="sales-overview-metrics">
        <Card className="sales-overview-card sales-overview-metric">
          <OverviewHeading title="Lead Stage Distribution" action={<OverviewLink onClick={() => onNavigate('/company/sales/leads')}>View leads</OverviewLink>} />
          {loading ? <Skeleton className="h-28 w-full" /> : (
            <>
              <dl className="sales-overview-stage-counts">
                {visibleStages.map(({ label, count }) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{metrics ? count.toLocaleString() : '—'}</dd>
                  </div>
                ))}
              </dl>
              <div className="sales-overview-stage-bar" aria-hidden="true">
                {stageValues.filter(({ count }) => count > 0).map(({ label, count, color }) => (
                  <span key={label} style={{ flexGrow: count, background: color }} />
                ))}
              </div>
            </>
          )}
        </Card>
        <Card className="sales-overview-card sales-overview-metric">
          <OverviewHeading title="Bid Pool Claim Velocity" info="Successful Bid Pool claims on leads you can view, grouped by day in your organization’s time zone." action={<OverviewLink onClick={() => onNavigate('/company/sales/bid-pool')}>View pool</OverviewLink>} />
          {loading && <Skeleton className="h-32 w-full" />}
          {metrics && <ClaimChart claims={metrics.dailyClaims} />}
          {!metrics && !loading && <p className="text-sm text-app-muted">Claim history is unavailable.</p>}
        </Card>
        <Card className="sales-overview-card sales-overview-metric">
          <OverviewHeading
            title="Pipeline Health"
            info="Percentages are based on open leads you can view. By status, inactive includes stalled and nurture leads. By stage, stalled leads stay in their current stage."
            action={(
              <select aria-label="Group pipeline health" className="sales-overview-select" value={byStage ? 'stage' : 'status'} onChange={(event) => setByStage(event.target.value === 'stage')}>
                <option value="status">By status</option>
                <option value="stage">By stage</option>
              </select>
            )}
          />
          {loading ? <Skeleton className="h-32 w-full" /> : (
            <div className="sales-overview-pipeline">
              <PipelineGauge total={metrics ? total : null} segments={health} />
              <dl className="sales-overview-legend">
                {health.map(({ label, count, color }) => (
                  <div key={label}>
                    <dt><span className="size-2 rounded-full" style={{ background: color }} aria-hidden="true" />{label}</dt>
                    <dd>{metrics ? `${total ? Math.round((count / total) * 100) : 0}%` : '—'}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </Card>
        {leaderboard}
      </div>
    </div>
  );
}

function ClaimChart({ claims }: { claims: SalesOverviewMetrics['dailyClaims'] }): React.JSX.Element {
  const maximum = Math.max(1, ...claims.map(({ count }) => count));
  const roughStep = maximum / 3;
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(1, roughStep)));
  const step = ([1, 2, 5, 10].find((factor) => factor * magnitude >= roughStep) ?? 10) * magnitude;
  const ticks = [3 * step, 2 * step, step, 0];

  return (
    <figure aria-label="Daily Bid Pool claims" className="sales-overview-chart">
      <ul className="sales-overview-chart-ticks" aria-hidden="true">
        {ticks.map((tick) => <li key={tick}>{tick.toLocaleString()}</li>)}
      </ul>
      <ol className="sales-overview-chart-bars">
        {claims.map(({ date, count }, index) => {
          const day = new Date(`${date}T00:00:00Z`);
          return (
            <li key={date} title={`${fullDate.format(day)} · ${count.toLocaleString()} claims`}>
              <span className="sr-only">{fullDate.format(day)}: {count.toLocaleString()} claims</span>
              <span aria-hidden="true" className="sales-overview-chart-column" style={{ height: `${(count / ticks[0]!) * 100}%` }} />
              <span aria-hidden="true" className={`sales-overview-chart-day ${index === claims.length - 1 ? 'is-today' : ''}`}>
                {weekday.format(day)}
              </span>
            </li>
          );
        })}
      </ol>
    </figure>
  );
}

function PipelineGauge({ total, segments }: { total: number | null; segments: ReadonlyArray<{ label: string; count: number; color: string }> }): React.JSX.Element {
  let offset = 0;
  const arc = 'M18 103 A82 82 0 0 1 182 103';
  return (
    <div className="sales-overview-gauge">
      <svg viewBox="0 0 200 120" fill="none" aria-hidden="true">
        <path d={arc} stroke="var(--app-border)" strokeWidth="14" strokeLinecap="round" />
        {total !== null && total > 0 && segments.filter(({ count }) => count > 0).map(({ label, count, color }) => {
          const length = (count / total) * 100;
          const start = offset;
          offset += length;
          const gap = length < 2 ? 0 : 1;
          return (
            <path
              key={label}
              d={arc}
              pathLength="100"
              stroke={color}
              strokeWidth="14"
              strokeDasharray={`${length - gap} 100`}
              strokeDashoffset={-start}
            />
          );
        })}
      </svg>
      <div>
        <span>Open leads</span>
        <strong>{total?.toLocaleString() ?? '—'}</strong>
      </div>
    </div>
  );
}
