import { useEffect, useState } from 'react';
import { Card, Empty, Loading, Notice, Page } from '../../ui/components.js';
import { listMyPenalties } from './api/penaltiesApi.js';
import { PenaltyDetailDrawer } from './components/PenaltyDetailDrawer.js';
import { MyPenaltyTable } from './components/MyPenaltyTable.js';
import type { Penalty } from './types/index.js';

const money = (paise: number): string =>
  `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

export function MyPenaltiesPage(): React.JSX.Element {
  const [rows, setRows] = useState<Penalty[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<Penalty | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState({ active: 0, total: 0, pending: 0 });
  useEffect(() => {
    setLoading(true);
    void listMyPenalties({ status: 'all', page, pageSize: 25 })
      .then((result) => {
        setRows(result.rows);
        setTotal(result.total);
        setTotalPages(result.totalPages);
        setSummary({
          active: result.summary.activeCount,
          total: Number(result.summary.activeAmountPaise),
          pending: Number(result.summary.pendingAmountPaise),
        });
      })
      .catch((cause) =>
        setError(
          cause instanceof Error ? cause.message : 'Unable to load your penalties.',
        ),
      )
      .finally(() => setLoading(false));
  }, [page]);
  return (
    <Page
      eyebrow="Advances · Penalties"
      title="My Penalties"
      description="View penalties recorded against your account."
    >
      {error && <Notice error>{error}</Notice>}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <p className="text-sm text-app-muted">Active penalties</p>
          <p className="mt-1 text-2xl font-bold">{summary.active}</p>
        </Card>
        <Card>
          <p className="text-sm text-app-muted">Total penalty amount</p>
          <p className="mt-1 text-2xl font-bold">{money(summary.total)}</p>
        </Card>
        <Card>
          <p className="text-sm text-app-muted">Pending payroll amount</p>
          <p className="mt-1 text-2xl font-bold">{money(summary.pending)}</p>
        </Card>
      </div>
      <Card className="overflow-hidden p-0">
        {loading ? (
          <div className="p-6">
            <Loading />
          </div>
        ) : rows.length === 0 ? (
          <Empty>No penalties have been recorded against your account.</Empty>
        ) : (
          <MyPenaltyTable rows={rows} onSelect={setSelected} />
        )}
        {!loading && total > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-app-border px-4 py-3 text-sm text-app-muted">
            <span>{total} penalties · Page {page} of {totalPages}</span>
            <div className="flex gap-2">
              <button className="rounded-lg border border-app-border px-3 py-2 disabled:opacity-50" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</button>
              <button className="rounded-lg border border-app-border px-3 py-2 disabled:opacity-50" disabled={page >= totalPages} onClick={() => setPage((value) => value + 1)}>Next</button>
            </div>
          </div>
        )}
      </Card>
      {selected && (
        <PenaltyDetailDrawer penalty={selected} onClose={() => setSelected(null)} />
      )}
    </Page>
  );
}
