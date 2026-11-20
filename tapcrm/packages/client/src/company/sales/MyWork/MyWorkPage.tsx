import { useCallback, useMemo, useState } from 'react';
import { Icon, Page } from '../../../ui/index.js';
import { BidPoolSection } from './sections/BidPoolSection.js';
import { DueActivitiesSection } from './sections/DueActivitiesSection.js';
import { HandoverOffersSection } from './sections/HandoverOffersSection.js';
import { NewlyAssignedSection } from './sections/NewlyAssignedSection.js';
import { summarize } from './myWork-helpers.js';
import { MY_WORK_ANCHORS, myWorkGuidance } from '../guide/page-guidance.js';
import { SalesCoach, focusGuideTarget, useSalesGuide } from '../guide/SalesGuide.js';

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
  const dueCallbacks = useMemo(() => ({ overdue: setOverdueCount, upcoming: setUpcomingCount }), []);
  const destinations = [
    { id: MY_WORK_ANCHORS.handovers, icon: 'arrow-left-right' },
    { id: MY_WORK_ANCHORS.callbacks, icon: 'phone' },
    { id: MY_WORK_ANCHORS.newlyAssigned, icon: 'user-plus' },
    { id: MY_WORK_ANCHORS.bidPool, icon: 'radio' },
    { id: 'my-work-upcoming', icon: 'calendar' },
  ];

  return (
    <Page
      eyebrow="Sales"
      title="My Work"
      description="What needs you today, most urgent first."
    >
      <nav className="sales-work-summary" aria-label="My work queues">
        {summary.map((entry, index) => {
          const destination = destinations[index]!;
          return (
            <button type="button" className="sales-work-summary-item text-left" key={destination.id} onClick={() => focusGuideTarget(destination.id)}>
              <span className="sales-work-icon" data-urgent={entry.urgent}><Icon name={destination.icon} className="size-5" /></span>
              <span className="min-w-0">
                <strong className="block font-display text-2xl leading-none tabular-nums">{entry.count}</strong>
                <span className="mt-1 block text-sm text-app-muted">{entry.label}</span>
              </span>
            </button>
          );
        })}
      </nav>
      <SalesCoach guidance={guidance} onNavigate={onNavigate} />

      {/* A column so "Callbacks in the next 24 hours" (order-last) ends the page. */}
      <div className="flex flex-col gap-5">
        <HandoverOffersSection userId={userId} onCountChange={handoverCallback} onNavigate={onNavigate} />
        <DueActivitiesSection userId={userId} onCountChange={dueCallbacks} onNavigate={onNavigate} />
        <NewlyAssignedSection userId={userId} onCountChange={newlyAssignedCallback} onNavigate={onNavigate} />
        <BidPoolSection onCountChange={bidPoolCallback} onNavigate={onNavigate} />
      </div>
    </Page>
  );
}
