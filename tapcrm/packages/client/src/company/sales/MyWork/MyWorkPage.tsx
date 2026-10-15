import { useCallback, useState } from 'react';
import { Page } from '../../../ui/components.js';
import { BidPoolSection } from './sections/BidPoolSection.js';
import { DueActivitiesSection } from './sections/DueActivitiesSection.js';
import { HandoverOffersSection } from './sections/HandoverOffersSection.js';
import { NewlyAssignedSection } from './sections/NewlyAssignedSection.js';
import { summarize } from './myWork-helpers.js';

/**
 * My Work (R1 plan step 1.14). Priority order:
 *   1. Live offers (bid pool)
 *   2. Overdue commitments (callbacks past due)
 *   3. Handover offers waiting on my decision
 *   4. Newly assigned leads (first-contact SLA)
 *   5. Upcoming actions (callbacks due in next 24h)
 *
 * Each section polls independently and reports its count up; the page
 * header shows the summary strip so the operator sees the shape of
 * their day at a glance.
 */
export function MyWorkPage({ userId, onNavigate }: { userId: string; onNavigate: (path: string) => void }): React.JSX.Element {
  const [bidPoolCount, setBidPoolCount] = useState(0);
  const [overdueCount, setOverdueCount] = useState(0);
  const [handoverCount, setHandoverCount] = useState(0);
  const [newlyAssignedCount, setNewlyAssignedCount] = useState(0);
  const [upcomingCount, setUpcomingCount] = useState(0);

  const summary = summarize(bidPoolCount, overdueCount, handoverCount, newlyAssignedCount, upcomingCount);

  const bidPoolCallback = useCallback((count: number) => setBidPoolCount(count), []);
  const handoverCallback = useCallback((count: number) => setHandoverCount(count), []);
  const newlyAssignedCallback = useCallback((count: number) => setNewlyAssignedCount(count), []);
  const dueCallbacks = {
    overdue: useCallback((count: number) => setOverdueCount(count), []),
    upcoming: useCallback((count: number) => setUpcomingCount(count), []),
  };

  return (
    <Page
      eyebrow="Sales"
      title="My Work"
      description="Your day, prioritised: live offers first, overdue commitments next, then upcoming actions."
    >
      <div className="mb-6 flex flex-wrap gap-2">
        {summary.map((entry) => (
          <span
            key={entry.label}
            className={`rounded-full px-3 py-1.5 text-xs font-bold ${
              entry.urgent ? 'bg-amber-500/20 text-amber-700' : 'bg-app-background text-app-muted'
            }`}
          >
            {entry.label} · {entry.count}
          </span>
        ))}
      </div>

      <BidPoolSection onCountChange={bidPoolCallback} onNavigate={onNavigate} />
      <DueActivitiesSection userId={userId} onCountChange={dueCallbacks} onNavigate={onNavigate} />
      <HandoverOffersSection userId={userId} onCountChange={handoverCallback} onNavigate={onNavigate} />
      <NewlyAssignedSection userId={userId} onCountChange={newlyAssignedCallback} onNavigate={onNavigate} />
    </Page>
  );
}
