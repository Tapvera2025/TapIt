import { useEffect, useState } from 'react';
import { Card } from '../../../../ui/components.js';
import { getLeads, type Lead } from '../../leads/api.js';
import { partitionLeads, relativeTime } from '../myWork-helpers.js';
import { MyWorkSection } from './Shell.js';

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
      getLeads()
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
      title="Newly assigned"
      count={newlyAssigned.length}
      urgent={newlyAssigned.length > 0}
      error={error}
      empty="No leads waiting on their first contact."
    >
      <Card className="p-0">
        <ul className="divide-y divide-app-border">
          {newlyAssigned.map((lead) => (
            <li key={lead.id} className="flex items-center justify-between gap-3 p-4">
              <div>
                <p className="font-semibold">{lead.contactName}</p>
                <p className="mt-1 text-xs text-app-muted">
                  #{lead.leadNumber} · {lead.sourceName}
                  {lead.companyName ? ` · ${lead.companyName}` : ''} · {relativeTime(lead.createdAt)}
                </p>
              </div>
              <button
                type="button"
                className="rounded-lg border border-app-border px-3 py-1.5 text-xs font-bold hover:border-app-accent"
                onClick={() => onNavigate(`/company/sales/leads/${lead.id}`)}
              >
                Open
              </button>
            </li>
          ))}
        </ul>
      </Card>
    </MyWorkSection>
  );
}
