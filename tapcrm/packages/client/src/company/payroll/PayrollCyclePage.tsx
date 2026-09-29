import { useEffect, useState } from 'react';
import { getPayrollCycle, type CycleStatus } from '../api/payrollApi.js';

function fmtPeriod(periodStart: string): string {
  return new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${periodStart}T12:00:00Z`));
}

export function PayrollCyclePage(): React.JSX.Element {
  const [data, setData] = useState<CycleStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getPayrollCycle()
      .then((d) => { setData(d); setLoading(false); })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Failed to load payroll status.');
        setLoading(false);
      });
  }, []);

  if (loading) return <div className="p-6 text-sm text-app-muted">Loading payroll status…</div>;
  if (error) return <div className="p-6 text-sm text-app-danger">{error}</div>;

  return (
    <div className="mx-auto max-w-lg space-y-4 p-4 sm:p-6">
      <div className="rounded-2xl border border-app-border bg-app-surface p-5">
        <p className="text-xs font-semibold uppercase tracking-wider text-app-muted">Latest payslip</p>
        {data?.currentSlip ? (
          <div className="mt-3 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-lg font-semibold">{fmtPeriod(data.currentSlip.periodStart)}</p>
              <span className="rounded-full bg-emerald-500/12 px-2.5 py-1 text-xs font-semibold text-emerald-800 dark:text-emerald-200">
                Published
              </span>
            </div>
            {data.currentSlip.revisionNumber > 0 && (
              <p className="text-xs text-app-muted">Revision {data.currentSlip.revisionNumber}</p>
            )}
            <p className="text-sm text-app-muted">
              View full details and amounts in{' '}
              <span className="text-app-foreground">My Payslips</span>.
            </p>
          </div>
        ) : (
          <p className="mt-3 text-sm text-app-muted">No published payslip yet.</p>
        )}
      </div>
    </div>
  );
}
