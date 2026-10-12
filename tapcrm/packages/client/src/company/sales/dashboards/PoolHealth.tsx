import { useEffect, useState } from 'react';
import { Card } from '../../../ui/components.js';
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
        <h2 className="font-display text-lg font-bold">Pool health — last 24h</h2>
        {snapshot && (
          <span className="text-xs text-app-muted">
            {snapshot.timeoutRate.toFixed(1)}% timed out of the pool
          </span>
        )}
      </header>
      {error && (
        <p className="mt-3 rounded-lg bg-[#d86b6b]/10 p-3 text-sm text-app-danger" role="alert">
          {error}
        </p>
      )}
      {snapshot === null ? (
        <p className="mt-3 text-sm text-app-muted">Loading…</p>
      ) : (
        <dl className="mt-4 grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
          <Metric label="Open now" value={snapshot.openNow} />
          <Metric label="Triage now" value={snapshot.triageNow} urgent={snapshot.triageNow > 0} />
          <Metric label="Claimed (24h)" value={snapshot.claimed24h} />
          <Metric label="Fallback (24h)" value={snapshot.fallback24h} />
          <Metric label="Triaged (24h)" value={snapshot.triaged24h} urgent={snapshot.triaged24h > 0} />
        </dl>
      )}
    </Card>
  );
}

function Metric({ label, value, urgent }: { label: string; value: number; urgent?: boolean }): React.JSX.Element {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-app-muted">{label}</dt>
      <dd className={`mt-1 font-display text-2xl font-bold ${urgent ? 'text-amber-600' : ''}`}>
        {value.toLocaleString()}
      </dd>
    </div>
  );
}
