import { useEffect, useState } from 'react';
import {
  listLeaves,
  listAvailableLeaveTypes,
  getLeaveBalances,
  submitLeave,
  cancelLeave,
  type LeaveRequestSummary,
  type LeaveTypeDto,
  type LeaveBalanceDto,
} from '../api/leaveApi.js';

function fmtDate(value: string): string {
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T12:00:00Z`));
}

const STATUS_CLASSES: Record<string, string> = {
  pending: 'bg-amber-500/14 text-amber-800 dark:text-amber-200',
  acknowledged: 'bg-sky-500/12 text-sky-800 dark:text-sky-200',
  approved: 'bg-emerald-500/12 text-emerald-800 dark:text-emerald-200',
  rejected: 'bg-rose-500/12 text-rose-800 dark:text-rose-200',
  cancelled: 'bg-app-surface-raised text-app-muted',
};

export function LeavePage({ userId, organizationTimeZone }: { userId: string; organizationTimeZone: string }): React.JSX.Element {
  const [leaves, setLeaves] = useState<LeaveRequestSummary[]>([]);
  const [leaveTypes, setLeaveTypes] = useState<LeaveTypeDto[]>([]);
  const [balances, setBalances] = useState<LeaveBalanceDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [supplementalError, setSupplementalError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [refreshingTypes, setRefreshingTypes] = useState(false);

  const currentYear = Number(new Intl.DateTimeFormat('en', {
    year: 'numeric',
    timeZone: organizationTimeZone,
  }).format(new Date()));

  const [leaveTypeId, setLeaveTypeId] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [fromHalf, setFromHalf] = useState<'full' | 'first' | 'second'>('full');
  const [toHalf, setToHalf] = useState<'full' | 'first' | 'second'>('full');
  const [reason, setReason] = useState('');

  async function load(): Promise<void> {
    setLoading(true);
    setError(null);
    setSupplementalError(null);
    const results = await Promise.allSettled([
      listLeaves({ userId }),
      listAvailableLeaveTypes(),
      getLeaveBalances(userId, currentYear),
    ]);
    const [leavesResult, typesResult, balancesResult] = results;
    if (leavesResult?.status === 'fulfilled') setLeaves(leavesResult.value);
    else setError(leavesResult?.reason instanceof Error ? leavesResult.reason.message : 'Unable to load leave requests.');
    if (typesResult?.status === 'fulfilled') setLeaveTypes(typesResult.value.filter((type) => type.isActive));
    else setSupplementalError((current) => [current, 'Leave types could not be loaded.'].filter(Boolean).join(' '));
    if (balancesResult?.status === 'fulfilled') setBalances(balancesResult.value);
    else setSupplementalError((current) => [current, 'Leave balances could not be loaded.'].filter(Boolean).join(' '));
    setLoading(false);
  }

  useEffect(() => { void load(); }, [userId]);

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!leaveTypeId || !fromDate || !toDate || !reason.trim()) {
      setFormError('All fields are required.');
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      await submitLeave({ leaveTypeId, fromDate, toDate, fromHalf, toHalf, reason: reason.trim() });
      setShowForm(false);
      setLeaveTypeId(''); setFromDate(''); setToDate('');
      setFromHalf('full'); setToHalf('full'); setReason('');
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to submit leave.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCancel(id: string): Promise<void> {
    try {
      await cancelLeave(id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to cancel leave.');
    }
  }

  async function refreshTypes(): Promise<void> {
    setRefreshingTypes(true);
    setFormError(null);
    try {
      setLeaveTypes((await listAvailableLeaveTypes()).filter((type) => type.isActive && type.kind === 'absence'));
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : 'Unable to load leave types.');
    } finally {
      setRefreshingTypes(false);
    }
  }

  return (
    <div className="space-y-4 p-4 sm:p-6">
      {/* Balances */}
      {balances.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {balances.map((b) => (
            <div key={b.leaveTypeId} className="rounded-xl bg-app-surface-raised px-3 py-2.5">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-app-muted">{b.leaveTypeName}</p>
              <p className="mt-0.5 text-base font-bold tabular-nums">
                {b.available}
                <span className="ml-1 text-xs font-normal text-app-muted">/ {b.opening + b.accrued} days</span>
              </p>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">My Leave Requests</h2>
        {!showForm && !loading && !error && (
          <button
            type="button"
            onClick={() => { setShowForm(true); void refreshTypes(); }}
            className="rounded-lg bg-app-accent px-3 py-1.5 text-xs font-semibold text-app-on-accent"
          >
            Apply for leave
          </button>
        )}
      </div>

      {supplementalError && (
        <div role="alert" className="flex flex-wrap items-center gap-2 text-xs text-app-danger">
          <span>{supplementalError}</span>
          <button type="button" onClick={() => void load()} className="underline underline-offset-2">
            Try again
          </button>
        </div>
      )}

      {showForm && (
        <form onSubmit={(e) => void handleSubmit(e)} className="rounded-2xl border border-app-border bg-app-surface p-5 space-y-4">
          <p className="text-sm font-semibold">Apply for leave</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label htmlFor="apply-leave-type" className="block text-xs font-semibold text-app-muted">Leave type</label>
              <select
                id="apply-leave-type"
                value={leaveTypeId}
                onChange={(e) => setLeaveTypeId(e.target.value)}
                required
                className="mt-1 w-full rounded-lg border border-app-border bg-app-surface px-3 py-1.5 text-sm"
              >
                <option value="">Select type…</option>
                {leaveTypes.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => void refreshTypes()}
                disabled={refreshingTypes}
                className="mt-1.5 text-xs font-semibold text-app-accent disabled:opacity-50"
              >
                {refreshingTypes ? 'Refreshing types…' : 'Refresh types'}
              </button>
              {!refreshingTypes && leaveTypes.length === 0 && (
                <p className="mt-1 text-xs text-app-muted">
                  No active absence leave types are available. Ask HR to configure one.
                </p>
              )}
            </div>
            <div>
              <label className="block text-xs font-semibold text-app-muted">From date</label>
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="mt-1 w-full rounded-lg border border-app-border bg-app-surface px-3 py-1.5 text-sm"
              />
              <select
                value={fromHalf}
                onChange={(e) => setFromHalf(e.target.value as typeof fromHalf)}
                className="mt-1 w-full rounded-lg border border-app-border bg-app-surface px-3 py-1.5 text-sm"
              >
                <option value="full">Full day</option>
                <option value="first">First half</option>
                <option value="second">Second half</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-app-muted">To date</label>
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="mt-1 w-full rounded-lg border border-app-border bg-app-surface px-3 py-1.5 text-sm"
              />
              <select
                value={toHalf}
                onChange={(e) => setToHalf(e.target.value as typeof toHalf)}
                className="mt-1 w-full rounded-lg border border-app-border bg-app-surface px-3 py-1.5 text-sm"
              >
                <option value="full">Full day</option>
                <option value="first">First half</option>
                <option value="second">Second half</option>
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-app-muted">Reason</label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={2}
                placeholder="State the reason for your leave…"
                className="mt-1 w-full rounded-lg border border-app-border bg-app-surface px-3 py-1.5 text-sm placeholder:text-app-muted focus:outline-none focus:ring-2 focus:ring-app-accent/30"
              />
            </div>
          </div>
          {formError && <p className="text-xs text-app-danger">{formError}</p>}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={submitting || refreshingTypes || leaveTypes.length === 0}
              className="rounded-lg bg-app-accent px-4 py-2 text-sm font-semibold text-app-on-accent disabled:opacity-50"
            >
              {submitting ? 'Submitting…' : 'Submit request'}
            </button>
            <button
              type="button"
              onClick={() => { setShowForm(false); setFormError(null); }}
              className="rounded-lg border border-app-border px-4 py-2 text-sm text-app-muted hover:border-app-accent"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {error && (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-app-danger">
          <span>{error}</span>
          <button type="button" onClick={() => void load()} className="rounded-lg border border-app-border px-3 py-1.5 text-app-foreground">
            Try again
          </button>
        </div>
      )}
      {loading && <p role="status" className="text-sm text-app-muted">Loading…</p>}

      {!loading && !error && leaves.length === 0 && (
        <div className="rounded-2xl border border-app-border bg-app-surface p-8 text-center text-sm text-app-muted">
          No leave requests yet.
        </div>
      )}

      {!loading && !error && leaves.length > 0 && (
        <div className="space-y-2">
          {[...leaves]
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
            .map((leave) => (
              <div key={leave.id} className="rounded-2xl border border-app-border bg-app-surface p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold">{leave.leaveTypeName}</p>
                    <p className="text-xs text-app-muted">
                      {fmtDate(leave.fromDate)} — {fmtDate(leave.toDate)}
                      {' · '}{leave.daysConsumed} day{leave.daysConsumed !== 1 ? 's' : ''}
                    </p>
                    {leave.reason && <p className="mt-1 text-xs text-app-muted">{leave.reason}</p>}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_CLASSES[leave.status] ?? STATUS_CLASSES['pending']}`}>
                      {leave.status}
                    </span>
                    {leave.allowedActions?.cancel && (
                      <button
                        type="button"
                        onClick={() => void handleCancel(leave.id)}
                        className="rounded-lg border border-app-border px-2.5 py-1 text-xs text-app-muted hover:border-rose-400 hover:text-rose-600"
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                </div>
                {leave.decisionNote && (
                  <p className="mt-2 text-xs text-app-muted border-t border-app-border pt-2">{leave.decisionNote}</p>
                )}
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
