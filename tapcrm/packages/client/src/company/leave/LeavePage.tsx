import { useEffect, useState } from 'react';
import {
  listLeaves,
  listAvailableLeaveTypes,
  getLeaveBalances,
  submitLeave,
  submitWfh,
  cancelLeave,
  type LeaveRequestSummary,
  type LeaveTypeDto,
  type LeaveBalanceDto,
} from '../api/leaveApi.js';
import { Button, GlassSurface, Page } from '../../ui/index.js';

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
  const [showWfhForm, setShowWfhForm] = useState(false);
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

    // Accumulate supplemental errors locally, then set once. The previous
    // callback form (setSupplementalError((current) => [current, msg].join(' ')))
    // duplicated the message when React StrictMode double-invoked the effect,
    // because each concurrent load() saw the other's setter output as `current`.
    const supplemental: string[] = [];
    if (typesResult?.status === 'fulfilled') setLeaveTypes(typesResult.value.filter((type) => type.isActive));
    else {
      const detail = typesResult?.reason instanceof Error ? typesResult.reason.message : '';
      supplemental.push(detail ? `Leave types could not be loaded: ${detail}` : 'Leave types could not be loaded.');
    }
    if (balancesResult?.status === 'fulfilled') setBalances(balancesResult.value);
    else {
      const detail = balancesResult?.reason instanceof Error ? balancesResult.reason.message : '';
      supplemental.push(detail ? `Leave balances could not be loaded: ${detail}` : 'Leave balances could not be loaded.');
    }
    setSupplementalError(supplemental.length ? supplemental.join(' ') : null);

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

  async function handleSubmitWfh(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!leaveTypeId || !fromDate || !toDate || !reason.trim()) {
      setFormError('All fields are required.');
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      await submitWfh({ leaveTypeId, fromDate, toDate, reason: reason.trim() });
      setShowWfhForm(false);
      setLeaveTypeId(''); setFromDate(''); setToDate(''); setReason('');
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to request WFH.');
    } finally {
      setSubmitting(false);
    }
  }

  async function refreshTypes(mode: 'absence' | 'wfh' = 'absence'): Promise<void> {
    setRefreshingTypes(true);
    setFormError(null);
    try {
      const kind = mode === 'wfh' ? 'attendance-mode' : 'absence';
      setLeaveTypes((await listAvailableLeaveTypes(kind)).filter((type) => type.isActive && type.kind === kind));
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : 'Unable to load leave types.');
    } finally {
      setRefreshingTypes(false);
    }
  }

  return (
    <Page eyebrow="Leave" title="My leave" description="Apply for leave, review your requests, and check your available balances.">
      {/* Balances */}
      {balances.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {balances.map((b) => (
            <GlassSurface key={b.leaveTypeId} className="min-w-44 rounded-xl px-3 py-2.5">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-app-muted">{b.leaveTypeName}</p>
              <p className="mt-0.5 text-base font-bold tabular-nums">
                {b.available}{' '}
                <span className="text-xs font-normal text-app-muted">
                  day{b.available === 1 ? '' : 's'} left of {b.opening + b.accrued + b.adjustments}
                </span>
              </p>
              <p className="text-[11px] text-app-muted">
                Used {b.consumed}{b.pending > 0 ? ` · ${b.pending} awaiting approval` : ''}
                {b.enforced ? ' · limit applies' : ''}
              </p>
            </GlassSurface>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">My Leave Requests</h2>
        {!showForm && !showWfhForm && !loading && !error && (
          <div className="flex gap-2">
            <Button
              kind="primary"
              onClick={() => { setShowForm(true); setLeaveTypeId(''); void refreshTypes('absence'); }}
              className="px-3 py-1.5 text-xs"
            >
              Apply for leave
            </Button>
            <Button
              kind="secondary"
              onClick={() => { setShowWfhForm(true); setLeaveTypeId(''); void refreshTypes('wfh'); }}
              className="border-app-accent/40 bg-app-accent/10 px-3 py-1.5 text-xs text-app-accent hover:bg-app-accent/15"
            >
              Request WFH
            </Button>
          </div>
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
        <form onSubmit={(e) => void handleSubmit(e)} className="ui-glass-surface space-y-4 rounded-2xl p-5">
          <p className="text-sm font-semibold">Apply for leave</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label htmlFor="apply-leave-type" className="block text-xs font-semibold text-app-muted">Leave type</label>
              <select
                id="apply-leave-type"
                value={leaveTypeId}
                onChange={(e) => setLeaveTypeId(e.target.value)}
                required
                className="ui-form-control mt-1 px-3 py-1.5 text-sm"
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
                className="ui-form-control mt-1 px-3 py-1.5 text-sm"
              />
              <select
                value={fromHalf}
                onChange={(e) => setFromHalf(e.target.value as typeof fromHalf)}
                className="ui-form-control mt-1 px-3 py-1.5 text-sm"
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
                className="ui-form-control mt-1 px-3 py-1.5 text-sm"
              />
              <select
                value={toHalf}
                onChange={(e) => setToHalf(e.target.value as typeof toHalf)}
                className="ui-form-control mt-1 px-3 py-1.5 text-sm"
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
                className="ui-form-control mt-1 px-3 py-1.5 text-sm placeholder:text-app-muted"
              />
            </div>
          </div>
          {formError && <p className="text-xs text-app-danger">{formError}</p>}
          <div className="flex gap-2">
            <Button
              type="submit"
              kind="primary"
              disabled={submitting || refreshingTypes || leaveTypes.length === 0}
              className="px-4 py-2 text-sm disabled:opacity-50"
            >
              {submitting ? 'Submitting…' : 'Submit request'}
            </Button>
            <Button
              kind="secondary"
              onClick={() => { setShowForm(false); setFormError(null); }}
              className="px-4 py-2 text-sm text-app-muted"
            >
              Cancel
            </Button>
          </div>
        </form>
      )}

      {showWfhForm && (
        <form onSubmit={(e) => void handleSubmitWfh(e)} className="ui-glass-surface space-y-4 rounded-2xl p-5">
          <p className="text-sm font-semibold">Request work from home</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label htmlFor="apply-wfh-type" className="block text-xs font-semibold text-app-muted">WFH type</label>
              <select
                id="apply-wfh-type"
                value={leaveTypeId}
                onChange={(e) => setLeaveTypeId(e.target.value)}
                required
                className="ui-form-control mt-1 px-3 py-1.5 text-sm"
              >
                <option value="">Select type…</option>
                {leaveTypes.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
              {!refreshingTypes && leaveTypes.length === 0 && (
                <p className="mt-1 text-xs text-app-muted">
                  No active WFH leave types are available. Ask HR to configure one.
                </p>
              )}
            </div>
            <div>
              <label className="block text-xs font-semibold text-app-muted">From date</label>
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="ui-form-control mt-1 px-3 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-app-muted">To date</label>
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="ui-form-control mt-1 px-3 py-1.5 text-sm"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-app-muted">Reason</label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={2}
                placeholder="Why do you need to work from home?"
                className="ui-form-control mt-1 px-3 py-1.5 text-sm placeholder:text-app-muted"
              />
            </div>
          </div>
          {formError && <p className="text-xs text-app-danger">{formError}</p>}
          <div className="flex gap-2">
            <Button
              type="submit"
              kind="primary"
              disabled={submitting || refreshingTypes || leaveTypes.length === 0}
              className="px-4 py-2 text-sm disabled:opacity-50"
            >
              {submitting ? 'Submitting…' : 'Request WFH'}
            </Button>
            <Button
              kind="secondary"
              onClick={() => { setShowWfhForm(false); setFormError(null); }}
              className="px-4 py-2 text-sm text-app-muted"
            >
              Cancel
            </Button>
          </div>
        </form>
      )}

      {error && (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-app-danger">
          <span>{error}</span>
          <Button kind="secondary" onClick={() => void load()} className="px-3 py-1.5 text-xs">
            Try again
          </Button>
        </div>
      )}
      {loading && <p role="status" className="text-sm text-app-muted">Loading…</p>}

      {!loading && !error && leaves.length === 0 && (
        <GlassSurface className="rounded-2xl p-8 text-center text-sm text-app-muted">
          No leave requests yet.
        </GlassSurface>
      )}

      {!loading && !error && leaves.length > 0 && (
        <div className="space-y-2">
          {[...leaves]
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
            .map((leave) => (
              <GlassSurface key={leave.id} className="rounded-2xl p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold">{leave.leaveTypeName}</p>
                    <p className="text-xs text-app-muted">
                      {fmtDate(leave.fromDate)} — {fmtDate(leave.toDate)}
                      {leave.kind === 'attendance-mode' ? ' · work from home' : <>{' · '}{leave.daysConsumed} day{leave.daysConsumed !== 1 ? 's' : ''}</>}
                    </p>
                    {leave.reason && <p className="mt-1 text-xs text-app-muted">{leave.reason}</p>}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_CLASSES[leave.status] ?? STATUS_CLASSES['pending']}`}>
                      {leave.status}
                    </span>
                    {leave.allowedActions?.cancel && (
                      <Button
                        kind="danger"
                        onClick={() => void handleCancel(leave.id)}
                        className="px-2.5 py-1 text-xs"
                      >
                        Cancel
                      </Button>
                    )}
                  </div>
                </div>
                {leave.decisionNote && (
                  <p className="mt-2 text-xs text-app-muted border-t border-app-border pt-2">{leave.decisionNote}</p>
                )}
              </GlassSurface>
            ))}
        </div>
      )}
    </Page>
  );
}
