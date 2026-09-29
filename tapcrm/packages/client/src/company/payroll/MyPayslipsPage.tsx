import { useEffect, useState } from 'react';
import { listMySlips, getSlipDetail, type SlipSummary, type SlipDetail } from '../api/payrollApi.js';

function fmtPaise(paise: string | number | undefined): string {
  if (paise === undefined || paise === null) return '—';
  const amount = Number(paise) / 100;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency', currency: 'INR', maximumFractionDigits: 0,
  }).format(amount);
}

function fmtPeriod(periodStart: string): string {
  return new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${periodStart}T12:00:00Z`));
}

function SlipDetailPanel({ slip, onClose }: { slip: SlipSummary; onClose: () => void }): React.JSX.Element {
  const [detail, setDetail] = useState<SlipDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setDetail(null);
    setError(null);
    const run = async () => {
      try {
        const d = await getSlipDetail(slip.id);
        setDetail(d);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load slip detail.');
      } finally {
        setLoading(false);
      }
    };
    void run();
  }, [slip.id]);

  return (
    <div className="rounded-2xl border border-app-border bg-app-surface p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-app-muted">Payslip</p>
          <p className="mt-0.5 text-base font-semibold">{fmtPeriod(slip.periodStart)}</p>
          {slip.revisionNumber > 0 && (
            <p className="text-xs text-app-muted">Revision {slip.revisionNumber}</p>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border border-app-border px-2.5 py-1 text-xs text-app-muted hover:border-app-accent"
        >
          Close
        </button>
      </div>

      {loading && <p className="text-sm text-app-muted">Loading…</p>}
      {error && <p className="text-sm text-app-danger">{error}</p>}

      {detail && (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'Gross', value: fmtPaise(detail.grossPaise) },
              { label: 'Deductions', value: fmtPaise(detail.deductionsPaise) },
              { label: 'Net pay', value: fmtPaise(detail.netPaise) },
            ].map(({ label, value }) => (
              <div key={label} className="rounded-xl bg-app-surface-raised p-3">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-app-muted">{label}</p>
                <p className="mt-0.5 text-lg font-bold tabular-nums">{value}</p>
              </div>
            ))}
          </div>
          <p className="text-xs text-app-muted">
            Payslip document download will be available when document generation is enabled.
          </p>
        </div>
      )}
    </div>
  );
}

export function MyPayslipsPage(): React.JSX.Element {
  const [slips, setSlips] = useState<SlipSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    const run = async () => {
      try {
        const { slips: data } = await listMySlips();
        setSlips(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load payslips.');
      } finally {
        setLoading(false);
      }
    };
    void run();
  }, []);

  const selected = slips.find((s) => s.id === selectedId) ?? null;

  return (
    <div className="space-y-4 p-4 sm:p-6">
      {error && <p className="text-sm text-app-danger">{error}</p>}
      {loading && <p className="text-sm text-app-muted">Loading payslips…</p>}

      {!loading && slips.length === 0 && (
        <div className="rounded-2xl border border-app-border bg-app-surface p-8 text-center text-sm text-app-muted">
          No published payslips yet.
        </div>
      )}

      {selected && (
        <SlipDetailPanel slip={selected} onClose={() => setSelectedId(null)} />
      )}

      {slips.length > 0 && (
        <div className="overflow-x-auto rounded-2xl border border-app-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-app-border text-left">
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-app-muted">Period</th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-app-muted">Gross</th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-app-muted">Net pay</th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-app-muted">Rev.</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {slips.map((slip) => (
                <tr
                  key={slip.id}
                  className={`border-b border-app-border last:border-0 hover:bg-app-surface-raised ${slip.id === selectedId ? 'bg-app-accent/5' : ''}`}
                >
                  <td className="px-4 py-3 font-medium">{fmtPeriod(slip.periodStart)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-app-muted">{fmtPaise(slip.grossPaise)}</td>
                  <td className="px-4 py-3 text-right tabular-nums font-semibold">{fmtPaise(slip.netPaise)}</td>
                  <td className="px-4 py-3 tabular-nums text-app-muted">{slip.revisionNumber}</td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => setSelectedId(slip.id === selectedId ? null : slip.id)}
                      className="rounded-lg border border-app-border px-2.5 py-1 text-xs text-app-muted hover:border-app-accent hover:text-app-foreground"
                    >
                      {slip.id === selectedId ? 'Hide' : 'View'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
