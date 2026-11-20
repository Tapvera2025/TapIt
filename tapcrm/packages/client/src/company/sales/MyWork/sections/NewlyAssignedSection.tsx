import { useEffect, useState } from 'react';
import { getLeads, type Lead } from '../../leads/api.js';
import { assignedTime, partitionLeads, relativeTime } from '../myWork-helpers.js';
import { MyWorkRow, MyWorkSection } from './Shell.js';
import { MY_WORK_ANCHORS } from '../../guide/page-guidance.js';

const POLL_INTERVAL_MS = 60_000;

export function NewlyAssignedSection({
  userId,
  onCountChange,
  onNavigate,
}: {
  userId: string;
  onCountChange: (count: number) => void;
  onNavigate: (path: string) => void;
}): React.JSX.Element {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    const load = (): void => {
      getLeads({ ownerId: userId, pageSize: 100 })
        .then((page) => {
          if (!cancelled) {
            setLeads(page.items);
            setError(null);
          }
        })
        .catch((cause: unknown) => {
          if (!cancelled) setError(cause instanceof Error ? cause.message : 'Unable to load leads.');
        });
    };
    load();
    const timer = setInterval(load, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [userId]);

  const { newlyAssigned } = partitionLeads(leads, userId);
  useEffect(() => {
    onCountChange(newlyAssigned.length);
  }, [newlyAssigned.length, onCountChange]);

  return (
    <MyWorkSection
      id={MY_WORK_ANCHORS.newlyAssigned}
      title="New leads to call"
      count={newlyAssigned.length}
      urgent={newlyAssigned.length > 0}
      error={error}
      empty="No new leads waiting for a first call."
    >
      <ul className="mt-3 divide-y divide-app-border border-t border-app-border">
          {newlyAssigned.map((lead) => (
            <MyWorkRow
              key={lead.id}
              icon="user-plus"
              title={lead.contactName}
              detail={[`#${lead.leadNumber}`, lead.companyName, lead.sourceName, `Assigned ${relativeTime(new Date(assignedTime(lead)).toISOString())}`].filter(Boolean).join(' · ')}
              action="Open lead"
              onAction={() => onNavigate(`/company/sales/leads/${lead.id}`)}
            />
          ))}
        </ul>
    </MyWorkSection>
  );
}
