import { useEffect, useState } from 'react';
import { Button, Card, Page } from '../../../ui/index.js';
import {
  getWinReadiness,
  listWinsToRecord,
  recordDealWin,
  type ReadinessReport,
  type WinsToRecordRow,
} from '../deals/api.js';
import { ReadinessPanel } from './ReadinessPanel.js';

const POLL_INTERVAL_MS = 30_000;

export function WinsToRecordPage({
  onNavigate,
}: {
  onNavigate: (path: string) => void;
}): React.JSX.Element {
  const [rows, setRows] = useState<readonly WinsToRecordRow[]>([]);
  const [readiness, setReadiness] = useState<Record<string, ReadinessReport | null>>({});
  const [readinessLoading, setReadinessLoading] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function reload(): Promise<void> {
    try {
      const next = await listWinsToRecord();
      setRows(next);
      setError(null);
      void hydrateReadiness(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load wins queue.');
    } finally {
      setLoading(false);
    }
  }

  async function hydrateReadiness(items: readonly WinsToRecordRow[]): Promise<void> {
    const flags: Record<string, boolean> = {};
    items.forEach((item) => {
      flags[item.id] = true;
    });
    setReadinessLoading(flags);
    const results = await Promise.allSettled(items.map((item) => getWinReadiness(item.id)));
    const next: Record<string, ReadinessReport | null> = {};
    const nextFlags: Record<string, boolean> = {};
    results.forEach((result, i) => {
      const id = items[i]!.id;
      next[id] = result.status === 'fulfilled' ? result.value : null;
      nextFlags[id] = false;
    });
    setReadiness(next);
    setReadinessLoading(nextFlags);
  }

  async function record(id: string): Promise<void> {
    setBusyId(id);
    setError(null);
    try {
      await recordDealWin(id);
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Record win failed.');
    } finally {
      setBusyId(null);
    }
  }

  useEffect(() => {
    void reload();
    const timer = window.setInterval(() => void reload(), POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The readiness report decides; until it loads, the list's own pre-check does.
  const isReady = (row: WinsToRecordRow) => readiness[row.id]?.canClose ?? Boolean(row.ready);
  const ready = rows.filter(isReady);
  const inProgress = rows.filter((row) => !isReady(row));

  const renderRow = (row: WinsToRecordRow) => {
    const report = readiness[row.id] ?? null;
    const canClose = Boolean(report?.canClose);
    const who = [row.contactName, row.responsibleCloserName ? `Closer: ${row.responsibleCloserName}` : null].filter(Boolean).join(' · ');
    return (
      <Card key={row.id}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <button
              type="button"
              onClick={() => onNavigate(`/company/sales/deals/${row.id}`)}
              className="text-left font-display text-lg font-bold hover:underline"
            >
              {row.title}
            </button>
            <p className="mt-1 text-xs text-app-muted">#{row.dealNumber}{who ? ` · ${who}` : ''}</p>
            <div className="mt-2 flex flex-wrap gap-1.5 text-xs font-semibold">
              <StatusChip label="Approval" value={row.approvalStatus} good={row.approvalStatus === 'approved' || row.approvalStatus === 'not_required'} />
              {row.contractStatus !== 'not_required' && <StatusChip label="Contract" value={row.contractStatus} good={row.contractStatus === 'signed'} />}
              {row.paymentStatus && <StatusChip label="Advance" value={row.paymentStatus} good={row.paymentStatus === 'advance_confirmed' || row.paymentStatus === 'paid'} />}
            </div>
          </div>
          <Button
            disabled={!canClose || busyId === row.id}
            title={canClose ? undefined : 'Every check below must be met first'}
            onClick={() => void record(row.id)}
          >
            {busyId === row.id ? 'Recording…' : 'Record win'}
          </Button>
        </div>
        <div className="mt-4">
          <ReadinessPanel
            dealId={row.id}
            report={report}
            loading={readinessLoading[row.id] ?? false}
            onNavigate={onNavigate}
          />
        </div>
      </Card>
    );
  };

  return (
    <Page
      eyebrow="Sales"
      title="Wins to record"
      description="Open deals with a published proposal. Deals that are ready come first; the rest show what is still missing before the win can be recorded."
      action={
        <Button kind="secondary" onClick={() => void reload()}>
          Refresh
        </Button>
      }
    >
      {error && (
        <p className="rounded-lg bg-[#d86b6b]/10 p-3 text-sm text-app-danger" role="alert">
          {error}
        </p>
      )}

      {loading && rows.length === 0 ? (
        <Card>
          <p className="text-sm text-app-muted">Loading wins queue…</p>
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <h2 className="font-display text-xl font-bold">Nothing to record yet</h2>
          <p className="mt-2 text-sm text-app-muted">
            A deal shows up here once its proposal is published. It moves to the top when the approval, the advance and the delivery brief are in place.
          </p>
        </Card>
      ) : (
        <>
          <section className="space-y-3">
            <h2 className="font-display text-lg font-bold">Ready to record <span className="text-app-muted">({ready.length})</span></h2>
            {ready.length === 0 ? (
              <Card><p className="text-sm text-app-muted">No deal is ready yet. The deals below show what each one still needs.</p></Card>
            ) : (
              <div className="grid gap-4">{ready.map(renderRow)}</div>
            )}
          </section>
          {inProgress.length > 0 && (
            <section className="space-y-3">
              <h2 className="font-display text-lg font-bold">On the way <span className="text-app-muted">({inProgress.length})</span></h2>
              <div className="grid gap-4">{inProgress.map(renderRow)}</div>
            </section>
          )}
        </>
      )}
    </Page>
  );
}

function StatusChip({ label, value, good }: { label: string; value: string; good: boolean }): React.JSX.Element {
  return (
    <span className={`rounded-full px-2.5 py-0.5 ${good ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' : 'bg-amber-500/15 text-amber-700 dark:text-amber-300'}`}>
      {label}: {value.replaceAll('_', ' ')}
    </span>
  );
}
