import { useEffect, useState } from 'react';
import { Card } from '../../../ui/index.js';
import { getPoolHealth, type PoolHealthSnapshot } from './dashboard-api.js';

const POLL_INTERVAL_MS = 30_000;

export function PoolHealth(): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<PoolHealthSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    const load = (): void => {
      getPoolHealth()
        .then((result) => {
          if (!cancelled) {
            setSnapshot(result);
            setError(null);
          }
        })
        .catch((cause: unknown) => {
          if (!cancelled) setError(cause instanceof Error ? cause.message : 'Unable to load pool health.');
        });
    };
    load();
    const timer = setInterval(load, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  return (
    <Card>
      <header className="flex items-center justify-between">
        <h2 className="font-display text-lg font-bold">Bid Pool health</h2>
        <span className="text-xs text-app-muted">Last 24 hours</span>
      </header>
      <p className="mt-1 text-sm text-app-muted">
        How quickly agents claim new enquiries.
        {snapshot && snapshot.timeoutRate > 0 && ` ${snapshot.timeoutRate.toFixed(1)}% were not claimed in time.`}
      </p>
      {error && (
        <p className="mt-3 rounded-lg bg-[#d86b6b]/10 p-3 text-sm text-app-danger" role="alert">
          {error}
        </p>
      )}
      {snapshot === null ? (
        <p className="mt-3 text-sm text-app-muted">Loading…</p>
      ) : (
        <dl className="mt-4 grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
          <Metric label="Waiting to be claimed" value={snapshot.openNow} />
          <Metric label="Need an owner now" value={snapshot.triageNow} urgent={snapshot.triageNow > 0} />
          <Metric label="Claimed by agents" value={snapshot.claimed24h} />
          <Metric label="Auto-assigned" value={snapshot.fallback24h} />
          <Metric label="Sent to Triage" value={snapshot.triaged24h} urgent={snapshot.triaged24h > 0} />
        </dl>
      )}
    </Card>
  );
}

function Metric({ label, value, urgent }: { label: string; value: number; urgent?: boolean }): React.JSX.Element {
  return (
    <div>
      <dt className="text-xs font-semibold text-app-muted">{label}</dt>
      <dd className={`mt-1 font-display text-2xl font-bold ${urgent ? 'text-amber-600' : ''}`}>
        {value.toLocaleString()}
      </dd>
    </div>
  );
}
