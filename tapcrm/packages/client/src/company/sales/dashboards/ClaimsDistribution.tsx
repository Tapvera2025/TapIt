import { useEffect, useState } from 'react';
import { Card } from '../../../ui/index.js';
import { getClaimsDistribution, type ClaimsDistributionRow } from './dashboard-api.js';

const POLL_INTERVAL_MS = 30_000;

export function ClaimsDistribution(): React.JSX.Element {
  const [rows, setRows] = useState<ClaimsDistributionRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    const load = (): void => {
      getClaimsDistribution()
        .then((result) => {
          if (!cancelled) {
            setRows(result.rows);
            setError(null);
          }
        })
        .catch((cause: unknown) => {
          if (!cancelled) setError(cause instanceof Error ? cause.message : 'Unable to load claims distribution.');
        });
    };
    load();
    const timer = setInterval(load, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const peak = rows.reduce((max, row) => Math.max(max, row.claimsToday), 0);

  return (
    <Card>
      <header className="flex items-center justify-between">
        <h2 className="font-display text-lg font-bold">Who is claiming leads</h2>
        <span className="text-xs text-app-muted">Today</span>
      </header>
      <p className="mt-1 text-sm text-app-muted">Bid Pool claims today and open leads, per person on the sales teams.</p>
      {error && (
        <p className="mt-3 rounded-lg bg-[#d86b6b]/10 p-3 text-sm text-app-danger" role="alert">
          {error}
        </p>
      )}
      <ul className="mt-4 space-y-2">
        {rows.length === 0 ? (
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
