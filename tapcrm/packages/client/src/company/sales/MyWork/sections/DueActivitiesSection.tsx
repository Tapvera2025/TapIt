import { useEffect, useState } from 'react';
import { Card } from '../../../../ui/components.js';
import { getAllCallbacks, type LeadCallback } from '../../leads/api.js';
import { partitionCallbacks, relativeTime } from '../myWork-helpers.js';
import { MyWorkSection } from './Shell.js';

const POLL_INTERVAL_MS = 30_000;

export function DueActivitiesSection({
  userId,
  onCountChange,
  onNavigate,
}: {
  userId: string;
  onCountChange: { overdue: (count: number) => void; upcoming: (count: number) => void };
  onNavigate: (path: string) => void;
}): React.JSX.Element {
  const [callbacks, setCallbacks] = useState<LeadCallback[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    const load = (): void => {
      getAllCallbacks({ ownerId: userId })
        .then((rows) => {
          if (!cancelled) {
            setCallbacks(rows);
            setError(null);
          }
        })
        .catch((cause: unknown) => {
          if (!cancelled) setError(cause instanceof Error ? cause.message : 'Unable to load callbacks.');
        });
    };
    load();
    const timer = setInterval(load, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [userId]);

  const { overdue, upcomingToday } = partitionCallbacks(callbacks, userId);
  useEffect(() => {
    onCountChange.overdue(overdue.length);
    onCountChange.upcoming(upcomingToday.length);
  }, [overdue.length, upcomingToday.length, onCountChange]);

  return (
    <>
      <MyWorkSection
        title="Overdue commitments"
        count={overdue.length}
        urgent={overdue.length > 0}
        error={error}
        empty="You are up to date on callbacks."
      >
        <Card className="p-0">
          <ul className="divide-y divide-app-border">
            {overdue.map((callback) => (
              <li key={callback.id} className="flex items-center justify-between gap-3 p-4">
                <div>
                  <p className="font-semibold">{callback.leadContactName}</p>
                  <p className="mt-1 text-xs text-app-muted">
                    #{callback.leadNumber} · {relativeTime(callback.scheduledAt)}{callback.reason ? ` · ${callback.reason}` : ''}
                  </p>
                </div>
                <button
                  type="button"
                  className="rounded-lg border border-app-border px-3 py-1.5 text-xs font-bold hover:border-app-accent"
                  onClick={() => onNavigate(`/company/sales/callbacks/${callback.id}`)}
                >
                  Record outcome
                </button>
              </li>
            ))}
          </ul>
        </Card>
      </MyWorkSection>

      <MyWorkSection
        title="Upcoming actions"
        count={upcomingToday.length}
        empty="No callbacks due in the next 24 hours."
      >
        <Card className="p-0">
          <ul className="divide-y divide-app-border">
            {upcomingToday.map((callback) => (
              <li key={callback.id} className="flex items-center justify-between gap-3 p-4">
                <div>
                  <p className="font-semibold">{callback.leadContactName}</p>
                  <p className="mt-1 text-xs text-app-muted">
                    #{callback.leadNumber} · {relativeTime(callback.scheduledAt)}{callback.reason ? ` · ${callback.reason}` : ''}
                  </p>
                </div>
                <button
                  type="button"
                  className="rounded-lg border border-app-border px-3 py-1.5 text-xs font-bold hover:border-app-accent"
                  onClick={() => onNavigate(`/company/sales/callbacks/${callback.id}`)}
                >
                  Open
                </button>
              </li>
            ))}
          </ul>
        </Card>
      </MyWorkSection>
    </>
  );
}
