import { useEffect, useState } from 'react';
import { Button, Card, Page } from '../../../ui/components.js';
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

  return (
    <Page
      eyebrow="Sales"
      title="Wins to record"
      description="Open deals that have cleared approval and contract. Verify readiness, then record the win."
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

      {loading && rows.length === 0 ? (
        <Card>
          <p className="text-sm text-app-muted">Loading wins queue…</p>
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <h2 className="font-display text-xl font-bold">Nothing to record</h2>
          <p className="mt-2 text-sm text-app-muted">
            Deals appear here once their approval and contract gates are green.
          </p>
        </Card>
      ) : (
        <div className="grid gap-4">
          {rows.map((row) => {
            const report = readiness[row.id] ?? null;
            const canClose = Boolean(report?.canClose);
            return (
              <Card key={row.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <button
                      type="button"
                      onClick={() => onNavigate(`/company/sales/deals/${row.id}`)}
                      className="font-display text-lg font-bold hover:underline"
                    >
                      {row.title}
                    </button>
                    <p className="mt-1 text-xs text-app-muted">
                      #{row.dealNumber} · Approval: {row.approvalStatus.replaceAll('_', ' ')} · Contract:{' '}
                      {row.contractStatus.replaceAll('_', ' ')}
                    </p>
                  </div>
                  <Button
                    disabled={!canClose || busyId === row.id}
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
          })}
        </div>
      )}
    </Page>
  );
}
