import { useCallback, useEffect, useState } from 'react';
import {
  adjustLeaveBalance,
  getLeaveBalanceOverview,
  type LeaveBalanceDto,
  type LeaveBalanceOverviewRow,
} from '../api/leaveApi.js';
import { Button, Modal, Notice, Page, SkeletonTable } from '../../ui/components.js';

function errorText(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

function AdjustBalance({
  row,
  balance,
  year,
  onClose,
  onSaved,
}: {
  row: LeaveBalanceOverviewRow;
  balance: LeaveBalanceDto;
  year: number;
  onClose: () => void;
  onSaved: (message: string) => void;
}): React.JSX.Element {
  const [direction, setDirection] = useState<'add' | 'remove'>('add');
  const [days, setDays] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const value = Number(days);
  const valid = days.trim() !== '' && value > 0 && Number.isInteger(value * 2) && reason.trim() !== '';

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await adjustLeaveBalance(row.userId, {
        leaveTypeId: balance.leaveTypeId,
        year,
        units: direction === 'add' ? value : -value,
        reason: reason.trim(),
      });
      onSaved(`${row.fullName}'s ${balance.leaveTypeName} balance is now ${result.available} day${result.available === 1 ? '' : 's'}.`);
    } catch (err) {
      setError(errorText(err, 'Unable to adjust the balance.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`Adjust ${balance.leaveTypeName} — ${row.fullName}`} onClose={onClose}>
      <form onSubmit={(e) => void submit(e)} className="space-y-4">
        <div className="grid grid-cols-2 gap-2 rounded-xl border border-app-border p-3 text-sm sm:grid-cols-4">
          <div><p className="text-xs text-app-muted">Entitlement {year}</p><p className="font-semibold">{balance.entitlement}</p></div>
          <div><p className="text-xs text-app-muted">Adjustments</p><p className="font-semibold">{balance.adjustments + balance.opening}</p></div>
          <div><p className="text-xs text-app-muted">Used</p><p className="font-semibold">{balance.consumed}</p></div>
          <div><p className="text-xs text-app-muted">Available</p><p className="font-semibold">{balance.available}</p></div>
        </div>
        <div className="flex gap-2">
          {(['add', 'remove'] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setDirection(option)}
              className={`flex-1 rounded-lg border px-3 py-2 text-sm font-semibold ${direction === option ? 'border-app-accent bg-app-accent/10 text-app-accent' : 'border-app-border text-app-muted'}`}
            >
              {option === 'add' ? 'Add days' : 'Remove days'}
            </button>
          ))}
        </div>
        <label className="block text-xs font-semibold text-app-muted">
          <span className="mb-2 block">Days (whole or half)</span>
          <input
            inputMode="decimal"
            value={days}
            onChange={(e) => setDays(e.target.value.replace(/[^0-9.]/g, ''))}
            className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2.5 text-sm text-app-foreground outline-none focus:border-app-accent"
          />
        </label>
        <label className="block text-xs font-semibold text-app-muted">
          <span className="mb-2 block">Reason (kept on record)</span>
          <input
            value={reason}
            placeholder="e.g. 3 days carried forward from 2025"
            onChange={(e) => setReason(e.target.value)}
            className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2.5 text-sm text-app-foreground outline-none focus:border-app-accent"
          />
        </label>
        {error && <Notice error>{error}</Notice>}
        <div className="flex justify-end gap-2">
          <Button kind="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy || !valid}>{busy ? 'Saving…' : 'Save adjustment'}</Button>
        </div>
      </form>
    </Modal>
  );
}

export function LeaveBalancesPage({ canAdjust }: { canAdjust: boolean }): React.JSX.Element {
  const [year, setYear] = useState(new Date().getFullYear());
  const [rows, setRows] = useState<LeaveBalanceOverviewRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [adjusting, setAdjusting] = useState<{ row: LeaveBalanceOverviewRow; balance: LeaveBalanceDto } | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      setRows(await getLeaveBalanceOverview(year));
      setError(null);
    } catch (err) {
      setError(errorText(err, 'Unable to load leave balances.'));
    } finally {
      setLoading(false);
    }
  }, [year]);

  useEffect(() => { void load(); }, [load]);

  const types = rows[0]?.balances ?? [];
  const visible = rows.filter((row) =>
    `${row.fullName} ${row.employeeId ?? ''} ${row.departmentName ?? ''}`.toLowerCase().includes(search.trim().toLowerCase()),
  );

  return (
    <Page
      eyebrow="Leave"
      title="Leave balances"
      description="Each leave type's yearly days, pro-rated for people who join or leave during the year, less approved leave. Adjust a balance for carried-forward days or corrections."
    >
      <div className="mt-6 flex flex-wrap items-end gap-3">
        <label className="text-xs font-semibold text-app-muted">
          <span className="mb-2 block">Year</span>
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="rounded-lg border border-app-border bg-app-background px-3 py-2.5 text-sm text-app-foreground outline-none focus:border-app-accent"
          >
            {[year - 1, year, year + 1].map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </label>
        <label className="min-w-64 flex-1 text-xs font-semibold text-app-muted">
          <span className="mb-2 block">Search</span>
          <input
            value={search}
            placeholder="Name, code or department"
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2.5 text-sm text-app-foreground outline-none focus:border-app-accent"
          />
        </label>
      </div>
      {notice && <div className="mt-4"><Notice>{notice}</Notice></div>}
      {error && <div className="mt-4"><Notice error>{error}</Notice></div>}
      {loading ? (
        <div className="mt-6"><SkeletonTable columns={5} rows={5} /></div>
      ) : types.length === 0 ? (
        <p className="mt-6 text-sm text-app-muted">No active leave types with balances. Create one under Leave Types.</p>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-2xl border border-app-border bg-app-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-app-border text-left text-xs uppercase tracking-wider text-app-muted">
                <th className="px-4 py-3">Employee</th>
                {types.map((t) => (
                  <th key={t.leaveTypeId} className="px-4 py-3 text-right">
                    {t.leaveTypeName}{t.enforced ? ' · limited' : ''}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                <tr key={row.userId} className="border-b border-app-border last:border-0">
                  <td className="px-4 py-3">
                    <p className="font-medium">{row.fullName}</p>
                    <p className="text-xs text-app-muted">{[row.employeeId, row.departmentName].filter(Boolean).join(' · ')}</p>
                  </td>
                  {row.balances.map((balance) => (
                    <td key={balance.leaveTypeId} className="px-4 py-3 text-right">
                      <button
                        type="button"
                        disabled={!canAdjust}
                        onClick={() => { setNotice(null); setAdjusting({ row, balance }); }}
                        className="rounded-lg px-2 py-1 text-right hover:bg-app-background disabled:cursor-default disabled:hover:bg-transparent"
                        aria-label={`${balance.leaveTypeName} for ${row.fullName}: ${balance.available} available`}
                      >
                        <span className={`font-semibold tabular-nums ${balance.available < 0 ? 'text-app-danger' : ''}`}>{balance.available}</span>
                        <span className="text-xs text-app-muted"> / {balance.opening + balance.accrued + balance.adjustments}</span>
                        <span className="block text-[11px] text-app-muted">
                          used {balance.consumed}{balance.pending > 0 ? ` · ${balance.pending} pending` : ''}
                        </span>
                      </button>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {adjusting && (
        <AdjustBalance
          row={adjusting.row}
          balance={adjusting.balance}
          year={year}
          onClose={() => setAdjusting(null)}
          onSaved={(message) => { setAdjusting(null); setNotice(message); void load(); }}
        />
      )}
    </Page>
  );
}
