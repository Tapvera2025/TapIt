import { useEffect } from 'react';
import { BidCard } from '../../BidPool/BidCard.js';
import { useBidPool } from '../../BidPool/useBidPool.js';
import { MyWorkSection } from './Shell.js';

/**
 * Live offers — same bid-pool cards as the standalone page, scoped
 * tighter and with the full-page "Refresh" affordance omitted.
 */
export function BidPoolSection({
  onCountChange,
  onNavigate,
}: {
  onCountChange: (count: number) => void;
  onNavigate: (path: string) => void;
}): React.JSX.Element {
  const { cards, loading, error, removeLocally } = useBidPool();
  useEffect(() => {
    onCountChange(cards.length);
  }, [cards.length, onCountChange]);
  return (
    <MyWorkSection
      title="Live offers"
      count={cards.length}
      urgent={cards.length > 0}
      error={error}
      empty={loading ? 'Loading…' : 'No live leads waiting on a claim.'}
      actionLabel="Open bid pool"
      onAction={() => onNavigate('/company/sales/bid-pool')}
    >
      {cards.length === 0 ? null : (
        <div className="grid gap-4 md:grid-cols-2">
          {cards.slice(0, 4).map((card) => (
            <BidCard
              key={card.leadId}
              card={card}
              callbacks={{
                onClaimed: (leadId) => {
                  removeLocally(leadId);
                  onNavigate(`/company/sales/leads/${leadId}`);
                },
                onPassed: (leadId) => removeLocally(leadId, { cooldown: true }),
                onLost: (leadId) => removeLocally(leadId),
              }}
            />
          ))}
        </div>
      )}
    </MyWorkSection>
  );
}
