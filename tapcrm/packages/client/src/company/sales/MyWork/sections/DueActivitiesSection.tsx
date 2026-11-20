import { useEffect, useState } from 'react';
import { getAllCallbacks, type LeadCallback } from '../../leads/api.js';
import { partitionCallbacks, relativeTime } from '../myWork-helpers.js';
import { MyWorkRow, MyWorkSection } from './Shell.js';
import { MY_WORK_ANCHORS } from '../../guide/page-guidance.js';

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
        id={MY_WORK_ANCHORS.callbacks}
        title="Overdue callbacks"
        count={overdue.length}
        urgent={overdue.length > 0}
        error={error}
        empty="No overdue callbacks."
      >
        <ul className="mt-3 divide-y divide-app-border border-t border-app-border">
            {overdue.map((callback) => (
            <MyWorkRow
              key={callback.id}
              icon="phone"
              title={callback.leadContactName}
              detail={[`#${callback.leadNumber}`, relativeTime(callback.scheduledAt), callback.reason].filter(Boolean).join(' · ')}
              action="Record outcome" urgent
              onAction={() => onNavigate(`/company/sales/callbacks/${callback.id}`)}
            />
            ))}
          </ul>
      </MyWorkSection>

      <MyWorkSection
        id="my-work-upcoming"
        className="order-last"
        title="Callbacks in the next 24 hours"
        count={upcomingToday.length}
        empty="No callbacks in the next 24 hours."
      >
        <ul className="mt-3 divide-y divide-app-border border-t border-app-border">
            {upcomingToday.map((callback) => (
            <MyWorkRow
              key={callback.id}
              icon="phone"
              title={callback.leadContactName}
              detail={[`#${callback.leadNumber}`, relativeTime(callback.scheduledAt), callback.reason].filter(Boolean).join(' · ')}
              action="Open callback"
              onAction={() => onNavigate(`/company/sales/callbacks/${callback.id}`)}
            />
            ))}
          </ul>
      </MyWorkSection>
    </>
  );
}
