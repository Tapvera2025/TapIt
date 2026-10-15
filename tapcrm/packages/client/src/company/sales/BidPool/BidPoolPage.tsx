import { useState } from 'react';
import { Button, Card, Page } from '../../../ui/components.js';
import { BidCard } from './BidCard.js';
import { useBidPool } from './useBidPool.js';

/**
 * Bid-pool page (R1 plan step 1.13). Lists open bid-pool cards for
 * the caller. Accept navigates to the lead; Pass hides the card
 * locally for 5 minutes while the server cooldown runs server-side.
 */

interface Toast {
  readonly id: number;
  readonly kind: 'info' | 'error' | 'warning';
  readonly message: string;
}

export function BidPoolPage({ onNavigate }: { onNavigate: (path: string) => void }): React.JSX.Element {
  const { cards, loading, error, refresh, removeLocally } = useBidPool();
  const [toasts, setToasts] = useState<Toast[]>([]);

  function pushToast(kind: Toast['kind'], message: string): void {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, kind, message }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4500);
  }

  return (
    <Page
      eyebrow="Sales"
      title="Bid Pool"
      description="Live inbound leads waiting on a claim. Act fast — pool cards expire after 10 minutes."
      action={
        <Button kind="secondary" onClick={() => void refresh()}>
          Refresh
        </Button>
      }
    >
      {error && (
        <p className="mb-4 rounded-lg bg-[#d86b6b]/10 p-3 text-sm text-app-danger" role="alert">
          {error}
        </p>
      )}

      <div className="pointer-events-none fixed inset-x-0 top-4 z-40 flex flex-col items-center gap-2">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role="status"
            className={`pointer-events-auto rounded-lg px-4 py-2 text-sm shadow-lg ${
              toast.kind === 'error'
                ? 'bg-[#d86b6b] text-white'
                : toast.kind === 'warning'
                  ? 'bg-amber-500 text-amber-950'
                  : 'bg-app-foreground text-app-background'
            }`}
          >
            {toast.message}
          </div>
        ))}
      </div>

      {loading && cards.length === 0 ? (
        <Card>
          <p className="text-sm text-app-muted">Loading bid-pool cards…</p>
        </Card>
      ) : cards.length === 0 ? (
        <Card>
          <h2 className="font-display text-xl font-bold">No live leads right now</h2>
          <p className="mt-2 text-sm text-app-muted">
            New leads from the website, Meta, GBP or WhatsApp will appear here within a few seconds.
          </p>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {cards.map((card) => (
            <BidCard
              key={card.leadId}
              card={card}
              callbacks={{
                onClaimed: (leadId) => {
                  removeLocally(leadId);
                  onNavigate(`/company/sales/leads/${leadId}`);
                },
                onPassed: (leadId) => {
                  removeLocally(leadId, { cooldown: true });
                  pushToast('info', 'Passed — hidden for 5 minutes.');
                },
                onLost: (leadId, kind, message) => {
                  removeLocally(leadId);
                  pushToast(kind === 'already_claimed' ? 'warning' : 'error', message);
                },
              }}
            />
          ))}
        </div>
      )}
    </Page>
  );
}
