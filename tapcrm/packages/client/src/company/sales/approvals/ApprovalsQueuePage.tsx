import { useEffect, useMemo, useState } from 'react';
import { Button, Card, Page } from '../../../ui/components.js';
import { listPendingApprovals, type ApprovalRequest } from './api.js';
import { getDeal, type Deal } from '../deals/api.js';
import { ApprovalCard } from './ApprovalCard.js';
import { describeSla } from './approvals-helpers.js';

const POLL_INTERVAL_MS = 30_000;

export function ApprovalsQueuePage({
  onNavigate,
}: {
  onNavigate: (path: string) => void;
}): React.JSX.Element {
  const [approvals, setApprovals] = useState<readonly ApprovalRequest[]>([]);
  const [deals, setDeals] = useState<Record<string, Deal>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function reload(): Promise<void> {
    try {
      const items = await listPendingApprovals();
      setApprovals(items);
      setError(null);
      await hydrateDeals(items);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load approvals.');
    } finally {
      setLoading(false);
    }
  }

  async function hydrateDeals(items: readonly ApprovalRequest[]): Promise<void> {
    const needed = Array.from(new Set(items.map((a) => a.dealId))).filter((id) => !deals[id]);
    if (needed.length === 0) return;
    const results = await Promise.allSettled(needed.map((id) => getDeal(id)));
    const next: Record<string, Deal> = { ...deals };
    results.forEach((result, i) => {
      if (result.status === 'fulfilled') next[needed[i]!] = result.value;
    });
    setDeals(next);
  }

  useEffect(() => {
    void reload();
    const timer = window.setInterval(() => void reload(), POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sorted = useMemo(() => {
    return [...approvals].sort((a, b) => {
      const slaA = describeSla(a.slaDueAt).secondsRemaining;
      const slaB = describeSla(b.slaDueAt).secondsRemaining;
      return slaA - slaB;
    });
  }, [approvals]);

  return (
    <Page
      eyebrow="Sales"
      title="Approvals queue"
      description="Approval requests awaiting your decision — sorted by SLA remaining."
      action={
        <Button kind="secondary" onClick={() => void reload()}>
          Refresh
        </Button>
      }
    >
      {error && (
        <p className="mb-4 rounded-lg bg-[#d86b6b]/10 p-3 text-sm text-app-danger" role="alert">
          {error}
        </p>
      )}

      {loading && approvals.length === 0 ? (
        <Card>
          <p className="text-sm text-app-muted">Loading pending approvals…</p>
        </Card>
      ) : sorted.length === 0 ? (
        <Card>
          <h2 className="font-display text-xl font-bold">No approvals waiting on you</h2>
          <p className="mt-2 text-sm text-app-muted">
            New requests from the proposals studio appear here within a few seconds.
          </p>
        </Card>
      ) : (
        <div className="grid gap-4">
          {sorted.map((approval) => (
            <ApprovalCard
              key={approval.id}
              approval={approval}
              deal={deals[approval.dealId] ?? null}
              onOpen={() => onNavigate(`/company/sales/deals/${approval.dealId}`)}
            />
          ))}
        </div>
      )}
    </Page>
  );
}
