import { useCallback, useState } from 'react';
import { Page } from '../../../ui/index.js';
import { BidPoolSection } from './sections/BidPoolSection.js';
import { DueActivitiesSection } from './sections/DueActivitiesSection.js';
import { HandoverOffersSection } from './sections/HandoverOffersSection.js';
import { NewlyAssignedSection } from './sections/NewlyAssignedSection.js';
import { summarize } from './myWork-helpers.js';
import { myWorkGuidance } from '../guide/page-guidance.js';
import { SalesCoach, useSalesGuide } from '../guide/SalesGuide.js';

/**
 * My Work (R1 plan step 1.14). Priority order:
 *   1. Live calls handed to me (a customer is on the line)
 *   2. Overdue callbacks
 *   3. Newly assigned leads (first-contact SLA)
 *   4. The Bid Pool (new enquiries to claim)
 *   5. Callbacks due in the next 24 hours
 *
 * Each section polls independently and reports its count up; the summary
 * strip and the sales guide use the counts to say what to do first.
 */
export function MyWorkPage({ userId, onNavigate }: { userId: string; onNavigate: (path: string) => void }): React.JSX.Element {
  const [bidPoolCount, setBidPoolCount] = useState(0);
  const [overdueCount, setOverdueCount] = useState(0);
  const [handoverCount, setHandoverCount] = useState(0);
  const [newlyAssignedCount, setNewlyAssignedCount] = useState(0);
  const [upcomingCount, setUpcomingCount] = useState(0);

  const summary = summarize(bidPoolCount, overdueCount, handoverCount, newlyAssignedCount, upcomingCount);
  const viewer = useSalesGuide()?.viewer ?? { isManager: false, canAddLeads: false, canRecordWin: false, canDecideApprovals: false };
  const guidance = myWorkGuidance(
    { handovers: handoverCount, overdue: overdueCount, newlyAssigned: newlyAssignedCount, bidPool: bidPoolCount, upcoming: upcomingCount },
    viewer,
  );

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
      description="What needs you today, most urgent first."
    >
      <SalesCoach guidance={guidance} onNavigate={onNavigate} />
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

      {/* A column so "Callbacks in the next 24 hours" (order-last) ends the page. */}
      <div className="flex flex-col">
        <HandoverOffersSection userId={userId} onCountChange={handoverCallback} onNavigate={onNavigate} />
        <DueActivitiesSection userId={userId} onCountChange={dueCallbacks} onNavigate={onNavigate} />
        <NewlyAssignedSection userId={userId} onCountChange={newlyAssignedCallback} onNavigate={onNavigate} />
        <BidPoolSection onCountChange={bidPoolCallback} onNavigate={onNavigate} />
      </div>
    </Page>
  );
}
