import { useEffect, useMemo, useRef, useState } from 'react';
import { loadLiveBoard, type LiveBoard, type LiveGroup, type LiveRow } from './liveApi.js';
import {
  connectRealtime,
  disconnectRealtime,
  setLiveBoardRefetch,
  subscribeConnectionState,
  type RealtimeConnectionState,
} from './realtimeClient.js';
import { Icon } from '../../ui/Icon.js';

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

// ─── Display status derivation ─────────────────────────────────────────────

export type DisplayStatus =
  | 'Working'
  | 'Working (Late)'
  | 'On Break'
  | 'Not Checked In'
  | 'On Leave'
  | 'Finished';

const GROUP_LABELS: Record<LiveGroup, string> = {
  working: 'Working',
  possiblyFinished: 'Possibly finished',
  onBreak: 'On break',
  finished: 'Finished',
  notInDue: 'Overdue',
  notInNotYetDue: 'Not yet due',
  onLeave: 'On leave',
  onHoliday: 'Holiday',
};

const GROUP_BAR_COLORS: Record<LiveGroup, string> = {
  working: 'bg-emerald-500',
  possiblyFinished: 'bg-sky-400',
  onBreak: 'bg-amber-400',
  finished: 'bg-neutral-300 dark:bg-neutral-600',
  notInDue: 'bg-rose-500',
  notInNotYetDue: 'bg-neutral-200 dark:bg-neutral-700',
  onLeave: 'bg-sky-300',
  onHoliday: 'bg-neutral-200 dark:bg-neutral-700',
};

export function deriveDisplayStatus(row: LiveRow): DisplayStatus {
  if (row.dayGroup === 'leave' || row.displayGroup === 'onLeave') {
    return 'On Leave';
  }
  if (row.dayGroup === 'holiday' || row.displayGroup === 'onHoliday') {
    return 'On Leave';
  }
  if (row.state === 'ON_BREAK') {
    return 'On Break';
  }
  if (row.state === 'FINISHED') {
    return 'Finished';
  }
  if (row.state === 'WORKING') {
    let isLate = false;
    if (row.lateMinutes != null && row.lateMinutes > 0) {
      isLate = true;
    } else {
      const punchIn = row.arrivalAt ?? row.since;
      if (punchIn && row.shiftStartAt) {
        const arrivalMs = new Date(punchIn).getTime();
        const shiftDueMs = new Date(row.shiftStartAt).getTime() + (row.graceMinutes ?? 0) * 60_000;
        if (!isNaN(arrivalMs) && !isNaN(shiftDueMs) && arrivalMs > shiftDueMs) {
          isLate = true;
        }
      }
    }
    return isLate ? 'Working (Late)' : 'Working';
  }
  return 'Not Checked In';
}

// ─── Time formatting helpers ────────────────────────────────────────────────

function formatTime(isoString: string | null | undefined): string {
  if (!isoString) return '—';
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
  } catch {
    return '—';
  }
}

/**
 * Format a number of minutes as a human-readable duration.
 *
 * @param minutes — the number of minutes to format
 * @param zeroAsDash — when true (default), 0 minutes → "—". When false, 0 minutes → "0m".
 *                     Use false for FINISHED/WORKING states where 0 is a valid value.
 */
export function formatDuration(minutes: number | null | undefined, zeroAsDash = true): string {
  if (minutes == null) return '—';
  if (zeroAsDash && minutes <= 0) return '—';
  if (!zeroAsDash && minutes < 0) return '0m';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

/**
 * Compute elapsed minutes from an ISO timestamp to `now`.
 * Returns 0 if the timestamp is invalid or in the future.
 */
function elapsedMinutes(sinceIso: string | null | undefined, nowMs: number): number {
  if (!sinceIso) return 0;
  const sinceMs = new Date(sinceIso).getTime();
  if (isNaN(sinceMs)) return 0;
  return Math.max(0, Math.floor((nowMs - sinceMs) / 60_000));
}

// ─── Live work & break time computation ────────────────────────────────────

/**
 * Compute the displayed work time for a row, incorporating a live clock tick.
 *
 * Backend semantics of `since`:
 *  - WORKING:  timestamp of the CURRENT working stretch start
 *              (last break-end if any, else arrival time).
 *              workedMinutes = accumulated work in PRIOR stretches.
 *              Live work = workedMinutes + elapsed(since, now).
 *  - ON_BREAK: timestamp of the CURRENT break start.
 *              workedMinutes = all accumulated work so far (break excluded).
 *              Live work = workedMinutes (unchanged while on break).
 *  - FINISHED: workedMinutes is the final authoritative value from the backend.
 *              We show it directly, no live clock needed.
 *  - NOT_IN:   → "—"
 */
export function computeLiveWorkTime(row: LiveRow, nowMs: number): string {
  if (row.state === 'NOT_IN' || row.dayGroup === 'leave' || row.displayGroup === 'onLeave' || row.displayGroup === 'onHoliday') {
    return '—';
  }

  if (row.state === 'FINISHED') {
    // Final value is authoritative. Show even if 0 (edge case: immediate in+out).
    return formatDuration(row.workedMinutes, false);
  }

  if (row.state === 'ON_BREAK') {
    // Work time does not increase during a break. Show accumulated work so far.
    // For ON_BREAK with 0 accumulated work (not possible in practice), show 0m.
    return formatDuration(row.workedMinutes, false);
  }

  if (row.state === 'WORKING') {
    // since = start of the CURRENT working stretch.
    // workedMinutes = accumulated work from prior stretches (may be 0 just after punch-in).
    const currentStretchMinutes = elapsedMinutes(row.since, nowMs);
    const totalMinutes = row.workedMinutes + currentStretchMinutes;
    // Show even if 0m (just punched in but since hasn't elapsed yet)
    return formatDuration(totalMinutes, false);
  }

  return '—';
}

/**
 * Compute the displayed break time for a row, incorporating a live clock tick.
 *
 * Backend semantics of `since` for ON_BREAK:
 *  - since = timestamp of the CURRENT break start.
 *  - breakMinutes = accumulated break from prior completed break stretches.
 *  - Live break = breakMinutes + elapsed(since, now).
 */
export function computeLiveBreakTime(row: LiveRow, nowMs: number): string {
  if (row.state === 'NOT_IN' || row.dayGroup === 'leave' || row.displayGroup === 'onLeave' || row.displayGroup === 'onHoliday') {
    return '—';
  }

  if (row.state === 'ON_BREAK') {
    // since = current break start. breakMinutes = prior accumulated break.
    const currentBreakMinutes = elapsedMinutes(row.since, nowMs);
    const totalBreakMinutes = row.breakMinutes + currentBreakMinutes;
    return formatDuration(totalBreakMinutes, false);
  }

  // WORKING, FINISHED: show accumulated break only (no ongoing break).
  if (row.state === 'FINISHED') {
    return formatDuration(row.breakMinutes, false);
  }

  if (row.state === 'WORKING') {
    // No ongoing break. Show accumulated break minutes.
    return formatDuration(row.breakMinutes, false);
  }

  return '—';
}

// ─── Punch In / Punch Out helpers ──────────────────────────────────────────

export function getPunchIn(row: LiveRow): string {
  if (row.dayGroup === 'leave' || row.displayGroup === 'onLeave' || row.displayGroup === 'onHoliday') {
    return '—';
  }
  if (row.state === 'NOT_IN') {
    return '—';
  }
  // Prefer authoritative arrival_at from attendance_record if available
  if (row.arrivalAt) {
    return formatTime(row.arrivalAt);
  }
  // For WORKING: since = last working stretch start, which is arrival if no breaks.
  // For ON_BREAK: since = current break start, NOT the arrival time.
  // For FINISHED: since = departure time.
  // Fallback for WORKING (no prior breaks): since is the arrival time.
  if (row.state === 'WORKING' || row.state === 'ON_BREAK') {
    // Use lastEventAt as a better approximation if since is the working stretch (not arrival)
    // since may be break-end if there were prior breaks. Try lastEventAt if available.
    // Actually the safest: for WORKING/ON_BREAK, if workedMinutes+breakMinutes > 0, derive arrival.
    if (row.since) {
      const sinceMs = new Date(row.since).getTime();
      if (!isNaN(sinceMs)) {
        // Try to reverse-compute arrival from since and accumulated durations
        const priorElapsedMs = (row.workedMinutes + row.breakMinutes) * 60_000;
        if (priorElapsedMs > 0) {
          // since = start of current stretch, arrival = since - priorElapsed (approx)
          // This is a reasonable approximation when arrivalAt is not provided
          return formatTime(new Date(sinceMs - priorElapsedMs).toISOString());
        }
        // No prior elapsed — since IS the arrival time
        return formatTime(row.since);
      }
    }
    if (row.lastEventAt) return formatTime(row.lastEventAt);
  }
  if (row.state === 'FINISHED') {
    if (row.since && row.workedMinutes > 0) {
      // since = departure for FINISHED. Arrival = departure - totalElapsed
      const depMs = new Date(row.since).getTime();
      if (!isNaN(depMs)) {
        const arrMs = depMs - (row.workedMinutes + row.breakMinutes) * 60_000;
        return formatTime(new Date(arrMs).toISOString());
      }
    }
  }
  return '—';
}

export function getPunchOut(row: LiveRow): string {
  // Prefer authoritative departure_at from attendance_record
  if (row.departureAt) {
    return formatTime(row.departureAt);
  }
  // FINISHED: since = departure time
  if (row.state === 'FINISHED' && row.since) {
    return formatTime(row.since);
  }
  return '—';
}

// ─── Legacy getWorkTime / getBreakTime kept for tests that use them ─────────
// These are static (no live clock). Use computeLiveWorkTime/computeLiveBreakTime for display.

export function getWorkTime(row: LiveRow): string {
  if (row.state === 'NOT_IN' || row.dayGroup === 'leave' || row.displayGroup === 'onLeave') {
    return '—';
  }
  if (row.state === 'FINISHED') {
    return formatDuration(row.workedMinutes, false);
  }
  return formatDuration(row.workedMinutes);
}

export function getBreakTime(row: LiveRow): string {
  if (row.state === 'NOT_IN' || row.dayGroup === 'leave' || row.displayGroup === 'onLeave') {
    return '—';
  }
  if (row.state === 'FINISHED') {
    return formatDuration(row.breakMinutes, false);
  }
  return formatDuration(row.breakMinutes);
}

// ─── Live ticker interval ──────────────────────────────────────────────────

/**
 * Tick period for the shared live clock.
 * 30 seconds is enough resolution for minute-granularity display;
 * shorter would be perceptually "live" without 1-second backend load.
 */
const TICK_INTERVAL_MS = 30_000;

// ─── Status badge UI ────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: DisplayStatus }): React.JSX.Element {
  const config = {
    'Working': {
      bg: 'bg-emerald-50 dark:bg-emerald-900/45 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-700/60',
      dot: 'bg-emerald-500',
    },
    'Working (Late)': {
      bg: 'bg-amber-50 dark:bg-amber-900/45 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-700/60',
      dot: 'bg-amber-500',
    },
    'On Break': {
      bg: 'bg-amber-50 dark:bg-amber-900/45 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-700/60',
      dot: 'bg-amber-400',
    },
    'Not Checked In': {
      bg: 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700',
      dot: 'bg-slate-400 dark:bg-slate-500',
    },
    'On Leave': {
      bg: 'bg-sky-50 dark:bg-sky-900/45 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-700/60',
      dot: 'bg-sky-400',
    },
    'Finished': {
      bg: 'bg-purple-50 dark:bg-purple-900/45 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-700/60',
      dot: 'bg-purple-400',
    },
  }[status];

  return (
    <span
      className={`workforce-status-badge status-${status.toLowerCase().replace(/[^a-z]+/g, '-')} inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${config.bg}`}
    >
      <span className={`size-1.5 rounded-full shrink-0 ${config.dot}`} aria-hidden="true" />
      {status}
    </span>
  );
}

function LiveDistributionBar({ groups, headcount }: { groups: Record<LiveGroup, number>; headcount: number }): React.JSX.Element {
  if (headcount === 0) return <></>;

  const segments = [
    { label: 'Working', count: (groups.working ?? 0), color: 'bg-emerald-500' },
    { label: 'On Break', count: (groups.onBreak ?? 0), color: 'bg-amber-400' },
    { label: 'Not Checked In', count: ((groups.notInDue ?? 0) + (groups.notInNotYetDue ?? 0)), color: 'bg-slate-400 dark:bg-slate-500' },
    { label: 'On Leave', count: ((groups.onLeave ?? 0) + (groups.onHoliday ?? 0)), color: 'bg-sky-400' },
    { label: 'Finished', count: ((groups.finished ?? 0) + (groups.possiblyFinished ?? 0)), color: 'bg-purple-500' },
  ].filter((s) => s.count > 0);

  return (
    <div className="dashboard-glass dashboard-glass-surface rounded-2xl border border-app-border p-4 shadow-2xs" role="img" aria-label="Workforce distribution">
      <div className="mb-2.5 flex items-center justify-between">
        <p className="text-[11px] font-bold uppercase tracking-wider text-app-muted">WORKFORCE DISTRIBUTION</p>
        <span className="text-xs font-semibold tabular-nums text-app-muted">{headcount} total</span>
      </div>
      <div className="workforce-distribution-track flex h-3 w-full overflow-hidden rounded-full gap-0.5" aria-hidden="true">
        {segments.map((s) => (
          <div
            key={s.label}
            className={`workforce-distribution-segment status-${s.label.toLowerCase().replace(/[^a-z]+/g, '-')} ${s.color} transition-all duration-300 first:rounded-l-full last:rounded-r-full`}
            style={{ width: `${(s.count / headcount) * 100}%` }}
            title={`${s.label}: ${s.count}`}
          />
        ))}
      </div>
      <div className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1.5">
        {segments.map((s) => {
          const pct = Math.round((s.count / headcount) * 100);
          return (
            <span key={s.label} className="flex items-center gap-1.5 text-xs text-app-muted">
              <span className={`inline-block size-2 rounded-full ${s.color}`} aria-hidden="true" />
              <span>{s.label}</span>
              <span className="font-bold text-app-foreground tabular-nums">{s.count}</span>
              <span className="text-app-muted font-normal">({pct}%)</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

// ─── Main page component ────────────────────────────────────────────────────

export function LiveBoardPage(): React.JSX.Element {
  const [board, setBoard] = useState<LiveBoard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [selectedDepartment, setSelectedDepartment] = useState<string>('all');
  const [page, setPage] = useState(1);
  const [connectionState, setConnectionState] = useState<RealtimeConnectionState>('connected');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState<LiveRow | null>(null);
  // Shared live clock — ticks every TICK_INTERVAL_MS to update displayed elapsed times.
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const abort = useRef<AbortController | null>(null);

  function load(): void {
    abort.current?.abort();
    abort.current = new AbortController();
    setIsRefreshing(true);
    let promise: ReturnType<typeof loadLiveBoard>;
    try {
      promise = loadLiveBoard(abort.current.signal);
    } catch (err) {
      setIsRefreshing(false);
      if (err instanceof Error && err.name !== 'AbortError') setError(err.message);
      return;
    }
    promise
      .then((b) => {
        setBoard(b);
        setError(null);
        // Refresh the local clock snapshot so live elapsed times reset from fresh data
        setNowMs(Date.now());
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name !== 'AbortError') setError(err.message);
      })
      .finally(() => {
        setIsRefreshing(false);
      });
  }

  useEffect(() => {
    setLiveBoardRefetch(load);
    connectRealtime();
    const unsubConnection = subscribeConnectionState(setConnectionState);
    load();

    // Shared live clock — updates nowMs every TICK_INTERVAL_MS.
    // This drives the live elapsed time displayed in Work Time / Break Time
    // columns without any backend writes or API calls.
    const ticker = setInterval(() => {
      setNowMs(Date.now());
    }, TICK_INTERVAL_MS);

    return () => {
      abort.current?.abort();
      clearInterval(ticker);
      unsubConnection();
      setLiveBoardRefetch(null);
      disconnectRealtime();
    };
  }, []);

  // Stable row data (no clock dependency) — only recomputed when backend data changes.
  const processedRows = useMemo(() => {
    if (!board) return [];
    return board.rows.map((row) => ({
      ...row,
      displayStatus: deriveDisplayStatus(row),
      punchIn: getPunchIn(row),
      punchOut: getPunchOut(row),
    }));
  }, [board]);

  // Live-clock-dependent display values — recomputed every tick AND on board refresh.
  // These are computed separately from stable data so filtering and sorting
  // remain efficient (they don't re-trigger when nowMs changes).
  const liveTimesMap = useMemo(() => {
    const map = new Map<string, { workTime: string; breakTime: string }>();
    if (!board) return map;
    for (const row of board.rows) {
      map.set(row.userId, {
        workTime: computeLiveWorkTime(row, nowMs),
        breakTime: computeLiveBreakTime(row, nowMs),
      });
    }
    return map;
  }, [board, nowMs]);

  // Unique departments for filter dropdown
  const departments = useMemo(() => {
    const set = new Set<string>();
    for (const row of processedRows) {
      if (row.departmentName) set.add(row.departmentName);
    }
    return Array.from(set).sort();
  }, [processedRows]);

  // Derived counts for summary chips (based on stable data)
  const counts = useMemo(() => {
    const c = {
      all: processedRows.length,
      working: 0,
      onBreak: 0,
      notCheckedIn: 0,
      onLeave: 0,
      finished: 0,
    };
    for (const row of processedRows) {
      if (row.displayStatus === 'Working' || row.displayStatus === 'Working (Late)') {
        c.working += 1;
      } else if (row.displayStatus === 'On Break') {
        c.onBreak += 1;
      } else if (row.displayStatus === 'Not Checked In') {
        c.notCheckedIn += 1;
      } else if (row.displayStatus === 'On Leave') {
        c.onLeave += 1;
      } else if (row.displayStatus === 'Finished') {
        c.finished += 1;
      }
    }
    return c;
  }, [processedRows]);

  // Filtered rows (based on stable data only)
  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return processedRows.filter((row) => {
      if (q) {
        const matchesName = row.fullName.toLowerCase().includes(q);
        const matchesDept = (row.departmentName ?? '').toLowerCase().includes(q);
        const matchesTeam = (row.teamName ?? '').toLowerCase().includes(q);
        if (!matchesName && !matchesDept && !matchesTeam) return false;
      }
      if (selectedDepartment !== 'all' && row.departmentName !== selectedDepartment) {
        return false;
      }
      if (selectedStatus !== 'all') {
        if (selectedStatus === 'Working' && row.displayStatus !== 'Working' && row.displayStatus !== 'Working (Late)') {
          return false;
        }
        if (selectedStatus === 'Working (Late)' && row.displayStatus !== 'Working (Late)') {
          return false;
        }
        if (selectedStatus === 'On Break' && row.displayStatus !== 'On Break') {
          return false;
        }
        if (selectedStatus === 'Not Checked In' && row.displayStatus !== 'Not Checked In') {
          return false;
        }
        if (selectedStatus === 'On Leave' && row.displayStatus !== 'On Leave') {
          return false;
        }
        if (selectedStatus === 'Finished' && row.displayStatus !== 'Finished') {
          return false;
        }
      }
      return true;
    });
  }, [processedRows, search, selectedDepartment, selectedStatus]);

  const hasActiveFilters = search.trim() !== '' || selectedStatus !== 'all' || selectedDepartment !== 'all';

  function resetFilters(): void {
    setSearch('');
    setSelectedStatus('all');
    setSelectedDepartment('all');
    setPage(1);
  }

  const pageSize = 6;
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const startIndex = (safePage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, filteredRows.length);
  const pagedRows = filteredRows.slice(startIndex, endIndex);

  // Error State
  if (error) {
    return (
      <div className="p-4 sm:p-6 max-w-7xl mx-auto">
        <div className="rounded-2xl border border-app-danger/30 bg-app-danger/5 p-8 text-center">
          <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-app-danger/10 text-app-danger">
            <Icon name="clock" className="size-6" />
          </div>
          <h2 className="mt-4 text-base font-semibold text-app-foreground">Unable to load live employee status</h2>
          <p className="mt-1 text-xs text-app-muted max-w-md mx-auto">{error}</p>
          <button
            type="button"
            onClick={() => { setError(null); load(); }}
            className="mt-5 inline-flex items-center gap-2 rounded-lg border border-app-border bg-app-surface px-4 py-2 text-xs font-semibold text-app-foreground hover:border-app-accent hover:text-app-accent transition-colors"
          >
            <Icon name="refresh" className="size-3.5" />
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="workforce-dashboard space-y-5 p-4 sm:p-6 max-w-7xl mx-auto">
      {/* Breadcrumbs */}
      <nav className="flex items-center gap-1.5 text-xs text-app-muted" aria-label="Breadcrumb">
        <span className="font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">COMPANY WORKSPACE</span>
        <span className="text-slate-400 dark:text-slate-600 font-medium">›</span>
        <span className="font-bold text-slate-800 dark:text-slate-200">Workforce Board</span>
      </nav>

      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-xl font-bold tracking-tight text-app-foreground sm:text-2xl">
            Employee Workforce
          </h1>
          <p className="mt-0.5 text-xs sm:text-sm text-app-muted">
            Live employee status and workforce presence
          </p>
        </div>

        <div className="flex items-center gap-2.5 self-start sm:self-auto">
          {/* Realtime connection indicator */}
          {connectionState === 'connected' ? (
            <span
              className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-700 dark:text-emerald-300"
              title="Real-time updates active"
            >
              <span className="size-2 rounded-full bg-emerald-500 animate-pulse" aria-hidden="true" />
              Live
            </span>
          ) : connectionState === 'reconnecting' ? (
            <span
              className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/25 bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-700 dark:text-amber-300"
              title="Reconnecting to real-time updates"
            >
              <span className="size-2 rounded-full bg-amber-500" aria-hidden="true" />
              Reconnecting
            </span>
          ) : (
            <span
              className="inline-flex items-center gap-1.5 rounded-full border border-app-border bg-app-surface-raised px-3 py-1 text-xs font-semibold text-app-muted"
              title="Updates paused or offline"
            >
              <span className="size-2 rounded-full bg-neutral-400" aria-hidden="true" />
              Offline
            </span>
          )}

          {/* Refresh Button */}
          <button
            type="button"
            onClick={() => load()}
            disabled={isRefreshing}
            className="inline-flex items-center gap-1.5 rounded-full border border-app-border bg-app-surface px-3.5 py-1 text-xs font-semibold text-app-foreground hover:border-app-accent hover:text-app-accent transition-colors disabled:opacity-50 shadow-2xs"
            aria-label="Refresh live workforce status"
          >
            <Icon name="refresh" className={`size-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* 6 Metric Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6" role="region" aria-label="Workforce metrics">
        {/* 1. All Employees */}
        <button
          type="button"
          onClick={() => { setSelectedStatus('all'); setPage(1); }}
          aria-pressed={selectedStatus === 'all'}
          className={`dashboard-glass workforce-metric-card metric-card-all flex flex-col items-start rounded-2xl border p-4 text-left transition-all cursor-pointer ${
            selectedStatus === 'all'
              ? 'border-blue-500 bg-blue-50/80 dark:bg-blue-900/40 shadow-xs ring-1 ring-blue-400'
              : 'border-blue-100 dark:border-blue-800/60 bg-blue-50/40 dark:bg-blue-900/20 hover:border-blue-300'
          }`}
        >
          <div className="flex size-9 items-center justify-center rounded-xl bg-blue-100 dark:bg-blue-800/45 text-blue-600 dark:text-blue-300">
            <Icon name="users" className="size-4" />
          </div>
          <span className="mt-3 text-xs font-semibold text-blue-600 dark:text-blue-400">All Employees</span>
          <span className="mt-1 text-2xl font-bold tracking-tight text-slate-900 dark:text-white tabular-nums">
            {counts.all}
          </span>
        </button>

        {/* 2. Working */}
        <button
          type="button"
          onClick={() => { setSelectedStatus(selectedStatus === 'Working' ? 'all' : 'Working'); setPage(1); }}
          aria-pressed={selectedStatus === 'Working'}
          className={`dashboard-glass workforce-metric-card metric-card-working flex flex-col items-start rounded-2xl border p-4 text-left transition-all cursor-pointer ${
            selectedStatus === 'Working'
              ? 'border-emerald-500 bg-emerald-50/80 dark:bg-emerald-900/40 shadow-xs ring-1 ring-emerald-400'
              : 'border-emerald-100 dark:border-emerald-800/60 bg-emerald-50/40 dark:bg-emerald-900/20 hover:border-emerald-300'
          }`}
        >
          <div className="flex size-9 items-center justify-center rounded-xl bg-emerald-100 dark:bg-emerald-800/45 text-emerald-600 dark:text-emerald-300">
            <Icon name="user" className="size-4" />
          </div>
          <span className="mt-3 text-xs font-semibold text-emerald-700 dark:text-emerald-300">Working</span>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white tabular-nums">
              {counts.working}
            </span>
            <span className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 flex items-center">
              ↑ 25% <span className="hidden xl:inline ml-1 font-normal text-app-muted">vs last hour</span>
            </span>
          </div>
        </button>

        {/* 3. On Break */}
        <button
          type="button"
          onClick={() => { setSelectedStatus(selectedStatus === 'On Break' ? 'all' : 'On Break'); setPage(1); }}
          aria-pressed={selectedStatus === 'On Break'}
          className={`dashboard-glass workforce-metric-card metric-card-break flex flex-col items-start rounded-2xl border p-4 text-left transition-all cursor-pointer ${
            selectedStatus === 'On Break'
              ? 'border-amber-500 bg-amber-50/80 dark:bg-amber-900/40 shadow-xs ring-1 ring-amber-400'
              : 'border-amber-100 dark:border-amber-800/60 bg-amber-50/40 dark:bg-amber-900/20 hover:border-amber-300'
          }`}
        >
          <div className="flex size-9 items-center justify-center rounded-xl bg-amber-100 dark:bg-amber-800/45 text-amber-600 dark:text-amber-300">
            <Icon name="coffee" className="size-4" />
          </div>
          <span className="mt-3 text-xs font-semibold text-amber-700 dark:text-amber-300">On Break</span>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white tabular-nums">
              {counts.onBreak}
            </span>
            <span className="text-[11px] font-semibold text-amber-600 dark:text-amber-400 flex items-center">
              ↑ 0% <span className="hidden xl:inline ml-1 font-normal text-app-muted">vs last hour</span>
            </span>
          </div>
        </button>

        {/* 4. Not Checked In */}
        <button
          type="button"
          onClick={() => { setSelectedStatus(selectedStatus === 'Not Checked In' ? 'all' : 'Not Checked In'); setPage(1); }}
          aria-pressed={selectedStatus === 'Not Checked In'}
          className={`dashboard-glass workforce-metric-card metric-card-not-checked-in flex flex-col items-start rounded-2xl border p-4 text-left transition-all cursor-pointer ${
            selectedStatus === 'Not Checked In'
              ? 'border-slate-500 bg-slate-100/90 dark:bg-slate-800/60 shadow-xs ring-1 ring-slate-500'
              : 'border-slate-200/80 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/55 hover:border-slate-400'
          }`}
        >
          <div className="flex size-9 items-center justify-center rounded-xl bg-slate-200 dark:bg-slate-700/80 text-slate-600 dark:text-slate-200">
            <Icon name="circle-dot" className="size-4" />
          </div>
          <span className="mt-3 text-xs font-semibold text-slate-700 dark:text-slate-300">Not Checked In</span>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white tabular-nums">
              {counts.notCheckedIn}
            </span>
            <span className="text-[11px] font-semibold text-rose-600 dark:text-rose-400 flex items-center">
              ↓ 17% <span className="hidden xl:inline ml-1 font-normal text-app-muted">vs last hour</span>
            </span>
          </div>
        </button>

        {/* 5. On Leave */}
        <button
          type="button"
          onClick={() => { setSelectedStatus(selectedStatus === 'On Leave' ? 'all' : 'On Leave'); setPage(1); }}
          aria-pressed={selectedStatus === 'On Leave'}
          className={`dashboard-glass workforce-metric-card metric-card-leave flex flex-col items-start rounded-2xl border p-4 text-left transition-all cursor-pointer ${
            selectedStatus === 'On Leave'
              ? 'border-sky-500 bg-sky-50/80 dark:bg-sky-900/40 shadow-xs ring-1 ring-sky-400'
              : 'border-sky-100 dark:border-sky-800/60 bg-sky-50/40 dark:bg-sky-900/20 hover:border-sky-300'
          }`}
        >
          <div className="flex size-9 items-center justify-center rounded-xl bg-sky-100 dark:bg-sky-800/45 text-sky-600 dark:text-sky-300">
            <Icon name="user" className="size-4" />
          </div>
          <span className="mt-3 text-xs font-semibold text-sky-700 dark:text-sky-300">On Leave</span>
          <span className="mt-1 text-2xl font-bold tracking-tight text-slate-900 dark:text-white tabular-nums">
            {counts.onLeave}
          </span>
        </button>

        {/* 6. Finished */}
        <button
          type="button"
          onClick={() => { setSelectedStatus(selectedStatus === 'Finished' ? 'all' : 'Finished'); setPage(1); }}
          aria-pressed={selectedStatus === 'Finished'}
          className={`dashboard-glass workforce-metric-card metric-card-finished flex flex-col items-start rounded-2xl border p-4 text-left transition-all cursor-pointer ${
            selectedStatus === 'Finished'
              ? 'border-purple-500 bg-purple-50/80 dark:bg-purple-900/40 shadow-xs ring-1 ring-purple-400'
              : 'border-purple-100 dark:border-purple-800/60 bg-purple-50/40 dark:bg-purple-900/20 hover:border-purple-300'
          }`}
        >
          <div className="flex size-9 items-center justify-center rounded-xl bg-purple-100 dark:bg-purple-800/45 text-purple-600 dark:text-purple-300">
            <Icon name="users" className="size-4" />
          </div>
          <span className="mt-3 text-xs font-semibold text-purple-700 dark:text-purple-300">Finished</span>
          <span className="mt-1 text-2xl font-bold tracking-tight text-slate-900 dark:text-white tabular-nums">
            {counts.finished}
          </span>
        </button>
      </div>

      {/* Workforce Distribution */}
      {board && <LiveDistributionBar groups={board.groups} headcount={board.rows.length} />}

      {/* Filter Bar */}
      {board && (
        <div className="dashboard-glass dashboard-glass-surface rounded-2xl border border-app-border p-3 flex flex-col sm:flex-row items-center justify-between gap-3 shadow-2xs">
          <div className="relative w-full sm:flex-1">
            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-app-muted">
              <Icon name="search" className="size-4" />
            </div>
            <input
              type="search"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              placeholder="Search employees or department…"
              className="w-full rounded-xl border border-app-border bg-app-surface py-2 pl-9 pr-8 text-xs sm:text-sm text-app-foreground placeholder:text-app-muted outline-none focus:border-app-accent focus:ring-1 focus:ring-app-accent transition-colors"
              aria-label="Search employees or department"
            />
            {search && (
              <button
                type="button"
                onClick={() => { setSearch(''); setPage(1); }}
                className="absolute inset-y-0 right-0 flex items-center pr-3 text-app-muted hover:text-app-foreground transition-colors cursor-pointer"
                aria-label="Clear search"
              >
                <Icon name="close" className="size-3.5" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-2.5 w-full sm:w-auto">
            <div className="relative w-1/2 sm:w-44">
              <select
                value={selectedStatus}
                onChange={(e) => { setSelectedStatus(e.target.value); setPage(1); }}
                className="w-full appearance-none rounded-xl border border-app-border bg-app-surface py-2 pl-3.5 pr-8 text-xs font-medium text-app-foreground outline-none focus:border-app-accent focus:ring-1 focus:ring-app-accent transition-colors cursor-pointer"
                aria-label="Filter by status"
              >
                <option value="all">All Statuses</option>
                <option value="Working">Working</option>
                <option value="Working (Late)">Working (Late)</option>
                <option value="On Break">On Break</option>
                <option value="Not Checked In">Not Checked In</option>
                <option value="On Leave">On Leave</option>
                <option value="Finished">Finished</option>
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2.5 text-app-muted">
                <Icon name="chevron-down" className="size-3.5" />
              </div>
            </div>

            <div className="relative w-1/2 sm:w-44">
              <select
                value={selectedDepartment}
                onChange={(e) => { setSelectedDepartment(e.target.value); setPage(1); }}
                disabled={departments.length === 0}
                className="w-full appearance-none rounded-xl border border-app-border bg-app-surface py-2 pl-3.5 pr-8 text-xs font-medium text-app-foreground outline-none focus:border-app-accent focus:ring-1 focus:ring-app-accent transition-colors cursor-pointer disabled:opacity-50"
                aria-label="Filter by department"
              >
                <option value="all">All Departments</option>
                {departments.map((dept) => (
                  <option key={dept} value={dept}>
                    {dept}
                  </option>
                ))}
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2.5 text-app-muted">
                <Icon name="chevron-down" className="size-3.5" />
              </div>
            </div>

            {hasActiveFilters && (
              <button
                type="button"
                onClick={resetFilters}
                className="inline-flex items-center gap-1.5 rounded-xl border border-app-border bg-app-surface px-3 py-2 text-xs font-medium text-app-muted hover:border-app-accent hover:text-app-foreground transition-colors cursor-pointer shrink-0"
                title="Clear filters"
              >
                <Icon name="close" className="size-3" />
                <span className="hidden sm:inline">Clear</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Main Content Area */}
      {!board ? (
        /* Loading Skeleton State */
        <div>
          {/* Desktop Skeleton */}
          <div className="dashboard-glass dashboard-glass-surface hidden md:block overflow-x-auto rounded-2xl border border-app-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-app-border bg-app-surface-raised text-left">
                  <th className="px-5 py-3.5 text-xs font-semibold uppercase tracking-wider text-app-muted">Employee</th>
                  <th className="px-5 py-3.5 text-xs font-semibold uppercase tracking-wider text-app-muted">Department</th>
                  <th className="px-5 py-3.5 text-xs font-semibold uppercase tracking-wider text-app-muted">Status</th>
                  <th className="px-5 py-3.5 text-xs font-semibold uppercase tracking-wider text-app-muted">Punch In</th>
                  <th className="px-5 py-3.5 text-xs font-semibold uppercase tracking-wider text-app-muted">Punch Out</th>
                  <th className="px-5 py-3.5 text-xs font-semibold uppercase tracking-wider text-app-muted">Work Time</th>
                  <th className="px-5 py-3.5 text-xs font-semibold uppercase tracking-wider text-app-muted">Break Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-app-border">
                {Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    <td className="px-5 py-3.5"><div className="h-4 w-32 rounded bg-app-border" /></td>
                    <td className="px-5 py-3.5"><div className="h-4 w-24 rounded bg-app-border" /></td>
                    <td className="px-5 py-3.5"><div className="h-5 w-20 rounded-full bg-app-border" /></td>
                    <td className="px-5 py-3.5"><div className="h-4 w-16 rounded bg-app-border" /></td>
                    <td className="px-5 py-3.5"><div className="h-4 w-16 rounded bg-app-border" /></td>
                    <td className="px-5 py-3.5"><div className="h-4 w-14 rounded bg-app-border" /></td>
                    <td className="px-5 py-3.5"><div className="h-4 w-12 rounded bg-app-border" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile Skeleton */}
          <div className="md:hidden space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="animate-pulse rounded-xl border border-app-border bg-app-surface p-4">
                <div className="flex items-start justify-between">
                  <div className="space-y-1.5">
                    <div className="h-4 w-28 rounded bg-app-border" />
                    <div className="h-3 w-20 rounded bg-app-border" />
                  </div>
                  <div className="h-5 w-20 rounded-full bg-app-border" />
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3 border-t border-app-border/70 pt-3">
                  <div className="h-8 rounded bg-app-border/60" />
                  <div className="h-8 rounded bg-app-border/60" />
                  <div className="h-8 rounded bg-app-border/60" />
                  <div className="h-8 rounded bg-app-border/60" />
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : filteredRows.length === 0 ? (
        /* Empty State */
        <div className="dashboard-glass dashboard-glass-surface rounded-2xl border border-app-border p-12 text-center">
          <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-app-surface-raised text-app-muted">
            <Icon name="users" className="size-6" />
          </div>
          <h2 className="mt-4 text-sm font-semibold text-app-foreground">No employees found</h2>
          <p className="mt-1 text-xs text-app-muted max-w-sm mx-auto">
            {hasActiveFilters
              ? 'No employees match your active search and filter criteria.'
              : 'No employee attendance records found for today.'}
          </p>
          {hasActiveFilters && (
            <button
              type="button"
              onClick={resetFilters}
              className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-app-border bg-app-surface px-3 py-1.5 text-xs font-semibold text-app-foreground hover:border-app-accent hover:text-app-accent transition-colors cursor-pointer"
            >
              Clear filters
            </button>
          )}
        </div>
      ) : (
        /* Employee Records Presentation */
        <>
          {/* Desktop Table Layout (md breakpoint and up) */}
          <div className="dashboard-glass dashboard-glass-surface hidden md:block overflow-x-auto rounded-2xl border border-app-border shadow-2xs">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-app-border bg-app-surface-raised/50 text-left">
                  <th className="px-4 py-3.5 text-xs font-bold uppercase tracking-wider text-app-muted">
                    {filteredRows.length} {filteredRows.length === 1 ? 'EMPLOYEE' : 'EMPLOYEES'}
                  </th>
                  <th className="px-4 py-3.5 text-xs font-bold uppercase tracking-wider text-app-muted">DEPARTMENT</th>
                  <th className="px-4 py-3.5 text-xs font-bold uppercase tracking-wider text-app-muted">STATUS</th>
                  <th className="px-4 py-3.5 text-xs font-bold uppercase tracking-wider text-app-muted tabular-nums">PUNCH IN</th>
                  <th className="px-4 py-3.5 text-xs font-bold uppercase tracking-wider text-app-muted tabular-nums">PUNCH OUT</th>
                  <th className="px-4 py-3.5 text-xs font-bold uppercase tracking-wider text-app-muted tabular-nums">WORK TIME</th>
                  <th className="px-4 py-3.5 text-xs font-bold uppercase tracking-wider text-app-muted tabular-nums">BREAK TIME</th>
                  <th className="px-4 py-3.5 text-xs font-bold uppercase tracking-wider text-app-muted text-center">ACTIONS</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-app-border/70">
                {pagedRows.map((row) => {
                  const liveTimes = liveTimesMap.get(row.userId) ?? { workTime: '—', breakTime: '—' };
                  const empCode = `EMP-${row.userId.replace(/[^0-9]/g, '').slice(-5).padStart(5, '0')}`;
                  return (
                    <tr
                      key={row.userId}
                      onClick={() => setSelectedEmployee(row)}
                      className="hover:bg-app-surface-raised/60 transition-colors cursor-pointer group"
                    >
                      <td className="px-4 py-3.5 font-medium text-app-foreground">
                        <div className="flex items-center gap-3">
                          <div className="size-9 rounded-full bg-[var(--app-accent)]/15 text-[var(--app-accent)] border border-[var(--app-accent)]/25 flex items-center justify-center text-xs font-bold shrink-0">
                            {getInitials(row.fullName)}
                          </div>
                          <div>
                            <div className="flex items-center gap-1.5">
                              <span className="font-semibold text-app-foreground">{row.fullName}</span>
                              {row.isWfh && (
                                <span className="rounded-md border border-app-border bg-app-surface-raised px-1.5 py-0.5 text-[10px] font-medium text-app-muted">
                                  WFH
                                </span>
                              )}
                            </div>
                            <span className="text-[11px] text-app-muted block">{empCode}</span>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3.5 text-app-muted text-xs font-medium">{row.departmentName ?? '—'}</td>
                      <td className="px-4 py-3.5">
                        <StatusBadge status={row.displayStatus} />
                      </td>
                      <td className="px-4 py-3.5 tabular-nums text-app-muted text-xs">{row.punchIn}</td>
                      <td className="px-4 py-3.5 tabular-nums text-app-muted text-xs">{row.punchOut}</td>
                      <td className="px-4 py-3.5 tabular-nums font-semibold text-app-foreground text-xs">{liveTimes.workTime}</td>
                      <td className="px-4 py-3.5 tabular-nums text-app-muted text-xs">{liveTimes.breakTime}</td>
                      <td className="px-4 py-3.5 text-center" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          onClick={() => setSelectedEmployee(row)}
                          className="size-7 rounded-lg border border-app-border bg-app-surface inline-flex items-center justify-center text-app-muted hover:text-app-foreground hover:border-app-accent transition-colors cursor-pointer"
                          aria-label={`Actions for ${row.fullName}`}
                          title="View employee details"
                        >
                          <span className="tracking-widest font-bold text-xs leading-none">•••</span>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Dedicated Mobile Card Layout (below md breakpoint) */}
          <div className="md:hidden space-y-3">
            {pagedRows.map((row) => {
              const liveTimes = liveTimesMap.get(row.userId) ?? { workTime: '—', breakTime: '—' };
              const empCode = `EMP-${row.userId.replace(/[^0-9]/g, '').slice(-5).padStart(5, '0')}`;
              return (
                <div
                  key={row.userId}
                  onClick={() => setSelectedEmployee(row)}
                  className="dashboard-glass dashboard-glass-surface rounded-2xl border border-app-border p-4 shadow-2xs space-y-3 cursor-pointer"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="size-9 rounded-full bg-[var(--app-accent)]/15 text-[var(--app-accent)] border border-[var(--app-accent)]/25 flex items-center justify-center text-xs font-bold shrink-0">
                        {getInitials(row.fullName)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <h3 className="text-sm font-semibold text-app-foreground truncate">
                            {row.fullName}
                          </h3>
                          {row.isWfh && (
                            <span className="rounded-md border border-app-border bg-app-surface-raised px-1.5 py-0.5 text-[10px] font-medium text-app-muted">
                              WFH
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-app-muted truncate">
                          {empCode} • {row.departmentName ?? '—'}
                        </p>
                      </div>
                    </div>
                    <div className="shrink-0">
                      <StatusBadge status={row.displayStatus} />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-x-4 gap-y-2 border-t border-app-border/70 pt-3 text-xs">
                    <div>
                      <span className="block text-[11px] text-app-muted">Punch In</span>
                      <span className="font-medium tabular-nums text-app-foreground">{row.punchIn}</span>
                    </div>
                    <div>
                      <span className="block text-[11px] text-app-muted">Punch Out</span>
                      <span className="font-medium tabular-nums text-app-foreground">{row.punchOut}</span>
                    </div>
                    <div>
                      <span className="block text-[11px] text-app-muted">Work Time</span>
                      <span className="font-semibold tabular-nums text-app-foreground">{liveTimes.workTime}</span>
                    </div>
                    <div>
                      <span className="block text-[11px] text-app-muted">Break Time</span>
                      <span className="font-medium tabular-nums text-app-foreground">{liveTimes.breakTime}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Pagination Controls */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-2 pt-2 text-xs text-app-muted">
            <div>
              Showing {filteredRows.length === 0 ? 0 : startIndex + 1}–{endIndex} of {filteredRows.length} employees
            </div>
            {totalPages > 1 && (
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={safePage <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="size-7 rounded-full flex items-center justify-center border border-app-border bg-app-surface text-app-muted hover:text-app-foreground hover:border-app-accent disabled:opacity-30 disabled:pointer-events-none transition-colors cursor-pointer"
                  aria-label="Previous page"
                >
                  <Icon name="chevron-left" className="size-3.5" />
                </button>
                {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => {
                  const isActive = p === safePage;
                  return (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setPage(p)}
                      className={`size-7 rounded-full flex items-center justify-center text-xs font-semibold transition-colors cursor-pointer ${
                        isActive
                          ? 'bg-[var(--app-accent)] text-white shadow-2xs font-bold'
                          : 'text-app-muted hover:text-app-foreground hover:bg-app-surface-raised'
                      }`}
                    >
                      {p}
                    </button>
                  );
                })}
                <button
                  type="button"
                  disabled={safePage >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  className="size-7 rounded-full flex items-center justify-center border border-app-border bg-app-surface text-app-muted hover:text-app-foreground hover:border-app-accent disabled:opacity-30 disabled:pointer-events-none transition-colors cursor-pointer"
                  aria-label="Next page"
                >
                  <Icon name="chevron-right" className="size-3.5" />
                </button>
              </div>
            )}
          </div>
        </>
      )}

      {/* Selected Employee Detail Modal */}
      {selectedEmployee && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4">
          <div className="dashboard-glass dashboard-glass-surface w-full max-w-md rounded-2xl border border-app-border p-6 shadow-xl space-y-5 animate-in fade-in zoom-in-95">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="size-11 rounded-full bg-[var(--app-accent)]/15 text-[var(--app-accent)] border border-[var(--app-accent)]/30 flex items-center justify-center text-sm font-bold">
                  {getInitials(selectedEmployee.fullName)}
                </div>
                <div>
                  <h2 className="text-base font-bold text-app-foreground">{selectedEmployee.fullName}</h2>
                  <p className="text-xs text-app-muted">
                    EMP-{selectedEmployee.userId.replace(/[^0-9]/g, '').slice(-5).padStart(5, '0')} • {selectedEmployee.departmentName ?? 'General'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedEmployee(null)}
                className="rounded-lg p-1.5 text-app-muted hover:bg-app-surface-raised hover:text-app-foreground cursor-pointer"
                aria-label="Close modal"
              >
                <Icon name="close" className="size-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 rounded-xl border border-app-border/80 bg-app-surface-raised/40 p-3.5 text-xs">
              <div>
                <span className="text-[11px] text-app-muted block">Status</span>
                <div className="mt-1">
                  <StatusBadge status={deriveDisplayStatus(selectedEmployee)} />
                </div>
              </div>
              <div>
                <span className="text-[11px] text-app-muted block">Work Mode</span>
                <span className="font-semibold text-app-foreground mt-1 inline-block">
                  {selectedEmployee.isWfh ? '🏠 Remote / WFH' : '🏢 Office'}
                </span>
              </div>
              <div>
                <span className="text-[11px] text-app-muted block">Punch In</span>
                <span className="font-medium text-app-foreground tabular-nums">{getPunchIn(selectedEmployee)}</span>
              </div>
              <div>
                <span className="text-[11px] text-app-muted block">Punch Out</span>
                <span className="font-medium text-app-foreground tabular-nums">{getPunchOut(selectedEmployee)}</span>
              </div>
              <div>
                <span className="text-[11px] text-app-muted block">Live Work Time</span>
                <span className="font-bold text-app-foreground tabular-nums">
                  {computeLiveWorkTime(selectedEmployee, nowMs)}
                </span>
              </div>
              <div>
                <span className="text-[11px] text-app-muted block">Live Break Time</span>
                <span className="font-bold text-app-foreground tabular-nums">
                  {computeLiveBreakTime(selectedEmployee, nowMs)}
                </span>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setSelectedEmployee(null)}
                className="rounded-xl border border-app-border bg-app-surface px-4 py-2 text-xs font-semibold text-app-foreground hover:border-app-accent hover:text-app-accent transition-colors cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
