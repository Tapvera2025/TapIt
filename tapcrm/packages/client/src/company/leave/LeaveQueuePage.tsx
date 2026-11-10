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
import { Button, GlassSurface, Page } from '../../ui/index.js';

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
    <GlassSurface className="rounded-2xl p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider text-app-muted">
          Leave coverage — {MONTHS[month - 1]} {year}
        </p>
        <div className="flex items-center gap-1">
          {maxCount > 0 && (
            <span className="mr-2 text-xs text-app-muted">{maxCount} max/day</span>
          )}
          <Button
            kind="secondary"
            onClick={prevMonth}
            aria-label="Previous month"
            className="size-8 px-1.5 py-0.5 text-xs text-app-muted"
          >
            ‹
          </Button>
          <Button
            kind="secondary"
            onClick={nextMonth}
            aria-label="Next month"
            className="size-8 px-1.5 py-0.5 text-xs text-app-muted"
          >
            ›
          </Button>
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
    </GlassSurface>
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
    <Page eyebrow="HR · Leave" title="Leave queue" description="Review employee leave requests and manage the approval workflow.">
      {canViewScopedCoverage && (
        <LeaveCoverageStrip onDateClick={(date) => { setCoverageDate(date); setFilter('all'); }} />
      )}

      {coverageDate && (
        <GlassSurface className="flex items-center gap-2 rounded-xl bg-amber-500/8 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
          <span>Filtering by date: <strong>{coverageDate}</strong></span>
          <Button
            kind="secondary"
            onClick={() => setCoverageDate(null)}
            className="ml-auto px-1.5 py-0.5 text-xs"
          >
            Clear
          </Button>
        </GlassSurface>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex rounded-lg border border-app-border p-0.5">
          {([
            'pending' as const,
            ...(canDecide ? ['approved' as const, 'all' as const] : []),
          ] as FilterStatus[]).map((f) => (
            <Button
              key={f}
              kind={filter === f ? 'primary' : 'secondary'}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 text-xs capitalize ${filter === f ? '' : 'text-app-muted hover:text-app-foreground'}`}
            >
              {f}
            </Button>
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
          <Button kind="secondary" onClick={load} className="px-3 py-1.5 text-xs">
            Try again
          </Button>
        </div>
      )}
      {loading && <p role="status" className="text-sm text-app-muted">Loading…</p>}

      {!loading && !error && displayed.length === 0 && (
        <GlassSurface className="rounded-2xl p-8 text-center text-sm text-app-muted">
          {coverageDate ? `No leave requests covering ${coverageDate}.` : 'No leave requests.'}
        </GlassSurface>
      )}

      {!loading && !error && displayed.length > 0 && (
        <div className="space-y-2">
          {[...displayed]
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
            .map((leave) => (
              <GlassSurface key={leave.id} className="rounded-2xl p-4">
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
                      {leave.kind === 'attendance-mode' ? ' · work from home' : <>{' · '}{leave.daysConsumed} day{leave.daysConsumed !== 1 ? 's' : ''}</>}
                    </p>
                    {leave.reason && (
                      <p className="mt-1 text-xs text-app-muted">{leave.reason}</p>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {leave.allowedActions.acknowledge && (
                      <Button
                        kind="secondary"
                        disabled={acknowledgingId === leave.id}
                        onClick={() => void handleAcknowledge(leave.id)}
                        className="px-2.5 py-1 text-xs text-app-muted hover:text-sky-600 disabled:opacity-50"
                      >
                        {acknowledgingId === leave.id ? 'Acknowledging…' : 'Acknowledge'}
                      </Button>
                    )}
                    {(leave.allowedActions.approve || leave.allowedActions.reject) && (
                      <Button
                        kind="secondary"
                        onClick={() => { setDecideId(leave.id); setDecisionNote(''); setActionError(null); }}
                        className="px-2.5 py-1 text-xs text-app-muted hover:text-app-foreground"
                      >
                        Decide
                      </Button>
                    )}
                    {leave.allowedActions.revoke && (
                      <Button
                        kind="danger"
                        onClick={() => { setDecideId(leave.id); setDecisionNote(''); setActionError(null); }}
                        className="px-2.5 py-1 text-xs text-app-muted hover:text-rose-600"
                      >
                        Revoke
                      </Button>
                    )}
                  </div>
                </div>

                {decideId === leave.id && (
                  <GlassSurface className="mt-3 space-y-2 rounded-xl p-3">
                    <div>
                      <label className="block text-xs font-semibold text-app-muted">Note (optional)</label>
                      <input
                        type="text"
                        value={decisionNote}
                        onChange={(e) => setDecisionNote(e.target.value)}
                        placeholder="Add a note…"
                        className="ui-form-control mt-1 px-3 py-1.5 text-sm"
                      />
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {leave.allowedActions.approve && (
                        <Button
                          kind="primary"
                          disabled={submitting}
                          onClick={() => void handleDecide(leave.id, 'approved')}
                          className="px-3 py-1.5 text-xs disabled:opacity-50"
                        >
                          Approve
                        </Button>
                      )}
                      {leave.allowedActions.reject && (
                        <Button
                          kind="danger"
                          disabled={submitting}
                          onClick={() => void handleDecide(leave.id, 'rejected')}
                          className="px-3 py-1.5 text-xs disabled:opacity-50"
                        >
                          Reject
                        </Button>
                      )}
                      {leave.allowedActions.revoke && (
                        <Button
                          kind="danger"
                          disabled={submitting}
                          onClick={() => void handleDecide(leave.id, 'revoked')}
                          className="px-3 py-1.5 text-xs disabled:opacity-50"
                        >
                          Revoke
                        </Button>
                      )}
                      <Button
                        kind="secondary"
                        onClick={() => { setDecideId(null); setDecisionNote(''); }}
                        className="px-3 py-1.5 text-xs text-app-muted"
                      >
                        Cancel
                      </Button>
                    </div>
                    {actionError && <p className="text-xs text-app-danger">{actionError}</p>}
                  </GlassSurface>
                )}
              </GlassSurface>
            ))}
        </div>
      )}
    </Page>
  );
}
