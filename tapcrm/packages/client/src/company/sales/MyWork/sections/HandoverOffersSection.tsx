import { useEffect, useState } from 'react';
import { getAllHandovers, type Handover } from '../../leads/api.js';
import { partitionHandovers, relativeTime } from '../myWork-helpers.js';
import { MyWorkRow, MyWorkSection } from './Shell.js';
import { MY_WORK_ANCHORS } from '../../guide/page-guidance.js';

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
      id={MY_WORK_ANCHORS.handovers}
      title="Live calls handed to you"
      count={pendingForMe.length}
      urgent={pendingForMe.length > 0}
      error={error}
      empty="No live calls waiting for you."
    >
      <ul className="mt-3 divide-y divide-app-border border-t border-app-border">
          {pendingForMe.map((handover) => (
            <MyWorkRow
              key={handover.id}
              icon="arrow-left-right"
              title={handover.leadContactName || 'Lead handover'}
              detail={[`From ${handover.fromUserName ?? 'another agent'}`, relativeTime(handover.offeredAt), handover.reason].filter(Boolean).join(' · ')}
              action="Review handover"
              urgent
              onAction={() => onNavigate(`/company/sales/leads/${handover.leadId}?focus=handover`)}
            />
          ))}
        </ul>
    </MyWorkSection>
  );
}
