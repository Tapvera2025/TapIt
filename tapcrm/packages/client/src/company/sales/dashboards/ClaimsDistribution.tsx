import { useState } from 'react';
import { Avatar } from '../../../chat/Avatar.js';
import { Card } from '../../../ui/index.js';
import { getClaimsDistribution } from './dashboard-api.js';
import { ErrorToast } from '../../../ui/ErrorToast.js';
import { OverviewHeading } from './SalesOverviewMetrics.js';
import { useOverviewData } from './useOverviewData.js';

export function ClaimsDistribution({ overview = false }: { overview?: boolean }): React.JSX.Element {
  const { data, error } = useOverviewData(getClaimsDistribution, 'Unable to load claims distribution.');
  const rows = data?.rows ?? [];
  const [expanded, setExpanded] = useState(false);
  const claimers = rows.filter((row) => row.claimsToday > 0);

  if (overview) {
    return (
      <Card className="sales-overview-card sales-overview-metric">
        <OverviewHeading
          title="Top Claiming Agents"
          info="Ranked by successful Bid Pool claims today."
          action={claimers.length > 3 && (
            <button className="sales-overview-link" type="button" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
              {expanded ? 'Show top 3' : 'View all'}
            </button>
          )}
        />
        {error && <ErrorToast message={error} />}
        {!data && !error && <p role="status" className="text-sm text-app-muted">Loading agents…</p>}
        {data && claimers.length === 0 && <p className="text-sm text-app-muted">No agents have claimed leads today.</p>}
        <ol className="sales-overview-ranking">
          {(expanded ? claimers : claimers.slice(0, 3)).map((row, index) => (
            <li key={row.userId}>
              <span className="text-sm font-bold tabular-nums text-app-muted">#{index + 1}</span>
              <Avatar name={row.fullName} seed={row.userId} size="md" />
              <div className="min-w-0">
                <p className="break-words font-semibold">{row.fullName}</p>
                <p className="text-xs text-app-muted">{row.activeLeads} open {row.activeLeads === 1 ? 'lead' : 'leads'}</p>
              </div>
              <span className={`sales-overview-claim-count ${index === 0 ? 'is-first' : ''}`}>{row.claimsToday} claimed</span>
            </li>
          ))}
        </ol>
      </Card>
    );
  }

  const peak = rows.reduce((max, row) => Math.max(max, row.claimsToday), 0);

  return (
    <Card>
      <header className="flex items-center justify-between">
        <h2 className="font-display text-lg font-bold">Who is claiming leads</h2>
        <span className="text-xs text-app-muted">Today</span>
      </header>
      <p className="mt-1 text-sm text-app-muted">Bid Pool claims today and open leads, per person on the sales teams.</p>
      {error && <ErrorToast message={error} />}
      <ul className="mt-4 space-y-2">
        {!data && !error ? (
          <li className="text-sm text-app-muted">Loading agents…</li>
        ) : data && rows.length === 0 ? (
          <li className="text-sm text-app-muted">Nobody on the sales teams yet. Add people to a sales team or pool in Organization.</li>
        ) : (
          rows.map((row) => (
            <li key={row.userId} className="grid grid-cols-[minmax(0,1fr)_minmax(2.5rem,6rem)_auto] items-center gap-3 text-sm">
              <span className="truncate font-semibold" title={row.fullName}>{row.fullName}</span>
              <span
                className="h-2 w-full rounded-full bg-app-background"
                aria-label={`${row.claimsToday} claims today`}
              >
                <span
                  className="block h-full rounded-full bg-app-accent"
                  style={{ width: peak === 0 ? '0%' : `${Math.round((row.claimsToday / peak) * 100)}%` }}
                />
              </span>
              <span className="whitespace-nowrap text-right text-xs tabular-nums">
                <span className="font-bold">{row.claimsToday}</span>
                <span className="ml-1 text-app-muted">claimed · {row.activeLeads} open</span>
              </span>
            </li>
          ))
        )}
      </ul>
    </Card>
  );
}
