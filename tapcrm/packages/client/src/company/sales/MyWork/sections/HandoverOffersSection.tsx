import { useEffect, useState } from 'react';
import { Card } from '../../../../ui/components.js';
import { getAllHandovers, type Handover } from '../../leads/api.js';
import { partitionHandovers, relativeTime } from '../myWork-helpers.js';
import { MyWorkSection } from './Shell.js';

const POLL_INTERVAL_MS = 30_000;

export function HandoverOffersSection({
  userId,
  onCountChange,
  onNavigate,
}: {
  userId: string;
  onCountChange: (count: number) => void;
  onNavigate: (path: string) => void;
}): React.JSX.Element {
  const [handovers, setHandovers] = useState<Handover[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    const load = (): void => {
      getAllHandovers('pending')
        .then((rows) => {
          if (!cancelled) {
            setHandovers(rows);
            setError(null);
          }
        })
        .catch((cause: unknown) => {
          if (!cancelled) setError(cause instanceof Error ? cause.message : 'Unable to load handovers.');
        });
    };
    load();
    const timer = setInterval(load, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [userId]);

  const { pendingForMe } = partitionHandovers(handovers, userId);
  useEffect(() => {
    onCountChange(pendingForMe.length);
  }, [pendingForMe.length, onCountChange]);

  return (
    <MyWorkSection
      title="Handover offers"
      count={pendingForMe.length}
      urgent={pendingForMe.length > 0}
      error={error}
      empty="No handovers waiting for a decision."
    >
      <Card className="p-0">
        <ul className="divide-y divide-app-border">
          {pendingForMe.map((handover) => (
            <li key={handover.id} className="flex items-center justify-between gap-3 p-4">
              <div>
                <p className="font-semibold">
                  From {handover.fromUserName ?? 'another agent'}
                  {handover.handoverMode === 'team_queue' ? ' · team queue' : ''}
                </p>
                <p className="mt-1 text-xs text-app-muted">
                  Offered {relativeTime(handover.offeredAt)}
                  {handover.reason ? ` · ${handover.reason}` : ''}
                </p>
              </div>
              <button
                type="button"
                className="rounded-lg border border-app-border px-3 py-1.5 text-xs font-bold hover:border-app-accent"
                onClick={() => onNavigate(`/company/sales/leads/${handover.leadId}`)}
              >
                Review
              </button>
            </li>
          ))}
        </ul>
      </Card>
    </MyWorkSection>
  );
}
