import { useEffect, useState } from 'react';
import {
  listLeaveAcknowledgements,
  listLeaveDecisions,
  acknowledgeLeave,
  decideLeave,
  getLeaveCalendar,
  type LeaveQueueItem,
  type LeaveCalendarEvent,
} from '../api/leaveApi.js';

function fmtDate(value: string): string {
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T12:00:00Z`));
}

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function heatClass(count: number): string {
  if (count === 0) return 'bg-app-surface-raised text-app-muted';
  if (count <= 2) return 'bg-amber-200/60 text-amber-900 dark:bg-amber-800/40 dark:text-amber-200';
  if (count <= 4) return 'bg-amber-400/60 text-amber-900 dark:bg-amber-600/50 dark:text-amber-100';
  return 'bg-rose-400/60 text-rose-900 dark:bg-rose-700/50 dark:text-rose-100';
}

function LeaveCoverageStrip({ onDateClick }: { onDateClick: (date: string) => void }): React.JSX.Element {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [events, setEvents] = useState<LeaveCalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    getLeaveCalendar(year, month)
      .then((data) => { setEvents(data); setLoading(false); })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : 'Unable to load leave coverage.');
        setLoading(false);
      });
  }, [year, month]);

  const daysInMonth = new Date(year, month, 0).getDate();
  const countsByDate: Record<string, number> = {};
  for (const ev of events) {
    if (ev.status === 'approved' || ev.status === 'acknowledged') {
      countsByDate[ev.date] = (countsByDate[ev.date] ?? 0) + 1;
    }
  }

  function prevMonth(): void {
    if (month === 1) { setYear((y) => y - 1); setMonth(12); }
    else setMonth((m) => m - 1);
  }
  function nextMonth(): void {
    if (month === 12) { setYear((y) => y + 1); setMonth(1); }
    else setMonth((m) => m + 1);
  }

  const maxCount = Math.max(...Object.values(countsByDate), 0);

  return (
    <div className="rounded-2xl border border-app-border bg-app-surface p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider text-app-muted">
          Leave coverage — {MONTHS[month - 1]} {year}
        </p>
        <div className="flex items-center gap-1">
          {maxCount > 0 && (
            <span className="mr-2 text-xs text-app-muted">{maxCount} max/day</span>
          )}
          <button
            type="button"
            onClick={prevMonth}
            aria-label="Previous month"
            className="rounded border border-app-border px-1.5 py-0.5 text-xs text-app-muted hover:border-app-accent"
          >
            ‹
          </button>
          <button
            type="button"
            onClick={nextMonth}
            aria-label="Next month"
            className="rounded border border-app-border px-1.5 py-0.5 text-xs text-app-muted hover:border-app-accent"
          >
            ›
          </button>
        </div>
      </div>
      {error ? (
        <p role="alert" className="text-xs text-app-danger">{error}</p>
      ) : loading ? (
        <p className="text-xs text-app-muted">Loading…</p>
      ) : (
        <div className="flex flex-wrap gap-1" role="list" aria-label={`Leave coverage for ${MONTHS[month - 1]} ${year}`}>
          {Array.from({ length: daysInMonth }, (_, i) => {
            const d = i + 1;
            const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            const count = countsByDate[dateStr] ?? 0;
            return (
              <button
                key={dateStr}
                type="button"
                role="listitem"
                aria-label={`${d} ${MONTHS[month - 1]}: ${count} on leave`}
                onClick={() => { if (count > 0) onDateClick(dateStr); }}
                className={`flex h-8 w-8 flex-col items-center justify-center rounded-lg text-[10px] font-semibold transition-opacity ${heatClass(count)} ${count > 0 ? 'cursor-pointer hover:opacity-80' : 'cursor-default'}`}
              >
                <span>{d}</span>
                {count > 0 && <span className="leading-none">{count}</span>}
              </button>
            );
          })}
        </div>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-3 text-[10px] text-app-muted">
        <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded bg-app-surface-raised" />None</span>
        <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded bg-amber-300/70" />1–2</span>
        <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded bg-amber-500/70" />3–4</span>
        <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded bg-rose-500/70" />5+</span>
      </div>
    </div>
  );
}

const STATUS_CLASSES: Record<string, string> = {
  pending: 'bg-amber-500/14 text-amber-800 dark:text-amber-200',
  acknowledged: 'bg-sky-500/12 text-sky-800 dark:text-sky-200',
  approved: 'bg-emerald-500/12 text-emerald-800 dark:text-emerald-200',
  rejected: 'bg-rose-500/12 text-rose-800 dark:text-rose-200',
  cancelled: 'bg-app-surface-raised text-app-muted',
};

type FilterStatus = 'pending' | 'approved' | 'all';

export function LeaveQueuePage({
  canAcknowledge,
  canDecide,
  canViewScopedCoverage,
}: {
  canAcknowledge: boolean;
  canDecide: boolean;
  canViewScopedCoverage: boolean;
}): React.JSX.Element {
  const [leaves, setLeaves] = useState<LeaveQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterStatus>('pending');
  const [coverageDate, setCoverageDate] = useState<string | null>(null);
  const [decideId, setDecideId] = useState<string | null>(null);
  const [decisionNote, setDecisionNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [acknowledgingId, setAcknowledgingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  function load(): void {
    setLoading(true);
    setError(null);
    setWarning(null);
    // Deciders see every request awaiting a decision (HR approves in one
    // step); someone who can only acknowledge sees their acknowledgement inbox.
    const sources: Array<{ name: string; request: Promise<LeaveQueueItem[]> }> = [];
    if (canDecide) {
      sources.push({ name: 'Decision inbox', request: listLeaveDecisions() });
    } else if (canAcknowledge) {
      sources.push({ name: 'Acknowledgement inbox', request: listLeaveAcknowledgements() });
    }
    if (sources.length === 0) {
      setLeaves([]);
      setLoading(false);
      return;
    }
    void Promise.allSettled(sources.map(({ request }) => request)).then((results) => {
      const fulfilled = results.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []);
      const rejected = results.flatMap((result, index) => result.status === 'rejected'
        ? [`${sources[index]!.name}: ${result.reason instanceof Error ? result.reason.message : 'Unable to load.'}`]
        : []);
      const available = fulfilled.flat().filter((leave) =>
        filter === 'all'
        || (filter === 'pending' && (leave.status === 'pending' || leave.status === 'acknowledged'))
        || leave.status === filter,
      );
      setLeaves(available);
      if (fulfilled.length === 0 && rejected.length > 0) setError(rejected.join(' '));
      else if (rejected.length > 0) setWarning(rejected.join(' '));
      setLoading(false);
    });
  }

  useEffect(() => { load(); }, [filter, canAcknowledge, canDecide]);

  async function handleAcknowledge(id: string): Promise<void> {
    setActionError(null);
    setAcknowledgingId(id);
    try {
      await acknowledgeLeave(id);
      load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to acknowledge.');
    } finally {
      setAcknowledgingId(null);
    }
  }

  async function handleDecide(id: string, decision: 'approved' | 'rejected' | 'revoked'): Promise<void> {
    setSubmitting(true);
    setActionError(null);
    try {
      await decideLeave(id, { decision, ...(decisionNote.trim() ? { decisionNote: decisionNote.trim() } : {}) });
      setDecideId(null);
      setDecisionNote('');
      load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to submit decision.');
    } finally {
      setSubmitting(false);
    }
  }

  const pendingCount = leaves.filter((l) => l.status === 'pending' || l.status === 'acknowledged').length;
  const displayed = coverageDate
    ? leaves.filter((l) => l.fromDate <= coverageDate && l.toDate >= coverageDate)
    : leaves;

  return (
    <div className="space-y-4 p-4 sm:p-6">
      {canViewScopedCoverage && (
        <LeaveCoverageStrip onDateClick={(date) => { setCoverageDate(date); setFilter('all'); }} />
      )}

      {coverageDate && (
        <div className="flex items-center gap-2 rounded-xl bg-amber-500/8 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
          <span>Filtering by date: <strong>{coverageDate}</strong></span>
          <button
            type="button"
            onClick={() => setCoverageDate(null)}
            className="ml-auto rounded border border-amber-400 px-1.5 py-0.5 text-xs hover:bg-amber-100 dark:hover:bg-amber-900/40"
          >
            Clear
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex rounded-lg border border-app-border p-0.5">
          {([
            'pending' as const,
            ...(canDecide ? ['approved' as const, 'all' as const] : []),
          ] as FilterStatus[]).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold capitalize ${filter === f ? 'bg-app-foreground text-app-surface' : 'text-app-muted hover:text-app-foreground'}`}
            >
              {f}
            </button>
          ))}
        </div>
        {pendingCount > 0 && (
          <span className="rounded-full bg-amber-500/14 px-2.5 py-1 text-xs font-semibold text-amber-800 dark:text-amber-200">
            {pendingCount} pending
          </span>
        )}
      </div>

      {warning && <p role="status" className="text-sm text-app-danger">{warning}</p>}
      {actionError && <p role="alert" className="text-sm text-app-danger">{actionError}</p>}
      {error && (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-app-danger">
          <span>{error}</span>
          <button type="button" onClick={load} className="rounded-lg border border-app-border px-3 py-1.5 text-app-foreground">
            Try again
          </button>
        </div>
      )}
      {loading && <p role="status" className="text-sm text-app-muted">Loading…</p>}

      {!loading && !error && displayed.length === 0 && (
        <div className="rounded-2xl border border-app-border bg-app-surface p-8 text-center text-sm text-app-muted">
          {coverageDate ? `No leave requests covering ${coverageDate}.` : 'No leave requests.'}
        </div>
      )}

      {!loading && !error && displayed.length > 0 && (
        <div className="space-y-2">
          {[...displayed]
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
            .map((leave) => (
              <div key={leave.id} className="rounded-2xl border border-app-border bg-app-surface p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold">{leave.userFullName}</p>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_CLASSES[leave.status] ?? STATUS_CLASSES['pending']}`}>
                        {leave.status}
                      </span>
                    </div>
                    <p className="text-xs text-app-muted">
                      {leave.leaveTypeName} · {fmtDate(leave.fromDate)} — {fmtDate(leave.toDate)}
                      {' · '}{leave.daysConsumed} day{leave.daysConsumed !== 1 ? 's' : ''}
                    </p>
                    {leave.reason && (
                      <p className="mt-1 text-xs text-app-muted">{leave.reason}</p>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {leave.allowedActions.acknowledge && (
                      <button
                        type="button"
                        disabled={acknowledgingId === leave.id}
                        onClick={() => void handleAcknowledge(leave.id)}
                        className="rounded-lg border border-app-border px-2.5 py-1 text-xs text-app-muted hover:border-sky-400 hover:text-sky-600 disabled:opacity-50"
                      >
                        {acknowledgingId === leave.id ? 'Acknowledging…' : 'Acknowledge'}
                      </button>
                    )}
                    {(leave.allowedActions.approve || leave.allowedActions.reject) && (
                      <button
                        type="button"
                        onClick={() => { setDecideId(leave.id); setDecisionNote(''); setActionError(null); }}
                        className="rounded-lg border border-app-border px-2.5 py-1 text-xs text-app-muted hover:border-app-accent hover:text-app-foreground"
                      >
                        Decide
                      </button>
                    )}
                    {leave.allowedActions.revoke && (
                      <button
                        type="button"
                        onClick={() => { setDecideId(leave.id); setDecisionNote(''); setActionError(null); }}
                        className="rounded-lg border border-app-border px-2.5 py-1 text-xs text-app-muted hover:border-rose-400 hover:text-rose-600"
                      >
                        Revoke
                      </button>
                    )}
                  </div>
                </div>

                {decideId === leave.id && (
                  <div className="mt-3 space-y-2 rounded-xl border border-app-border p-3">
                    <div>
                      <label className="block text-xs font-semibold text-app-muted">Note (optional)</label>
                      <input
                        type="text"
                        value={decisionNote}
                        onChange={(e) => setDecisionNote(e.target.value)}
                        placeholder="Add a note…"
                        className="mt-1 w-full rounded-lg border border-app-border bg-app-surface px-3 py-1.5 text-sm"
                      />
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {leave.allowedActions.approve && (
                        <button
                          type="button"
                          disabled={submitting}
                          onClick={() => void handleDecide(leave.id, 'approved')}
                          className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                        >
                          Approve
                        </button>
                      )}
                      {leave.allowedActions.reject && (
                        <button
                          type="button"
                          disabled={submitting}
                          onClick={() => void handleDecide(leave.id, 'rejected')}
                          className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                        >
                          Reject
                        </button>
                      )}
                      {leave.allowedActions.revoke && (
                        <button
                          type="button"
                          disabled={submitting}
                          onClick={() => void handleDecide(leave.id, 'revoked')}
                          className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                        >
                          Revoke
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => { setDecideId(null); setDecisionNote(''); }}
                        className="rounded-lg border border-app-border px-3 py-1.5 text-xs text-app-muted hover:border-app-accent"
                      >
                        Cancel
                      </button>
                    </div>
                    {actionError && <p className="text-xs text-app-danger">{actionError}</p>}
                  </div>
                )}
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
