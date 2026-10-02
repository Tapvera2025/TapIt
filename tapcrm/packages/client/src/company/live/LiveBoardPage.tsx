import { useEffect, useRef, useState } from 'react';
import { loadLiveBoard, type LiveBoard, type LiveGroup, type LiveRow } from './liveApi.js';
import { connectRealtime, disconnectRealtime, getConnectionFailed, setLiveBoardRefetch } from './realtimeClient.js';

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

const GROUP_CLASSES: Record<LiveGroup, string> = {
  working: 'bg-emerald-500/12 text-emerald-800 dark:text-emerald-200',
  possiblyFinished: 'bg-sky-500/12 text-sky-800 dark:text-sky-200',
  onBreak: 'bg-amber-500/14 text-amber-800 dark:text-amber-200',
  finished: 'bg-app-surface-raised text-app-muted',
  notInDue: 'bg-rose-500/12 text-rose-800 dark:text-rose-200',
  notInNotYetDue: 'bg-app-surface-raised text-app-muted',
  onLeave: 'bg-sky-500/12 text-sky-800 dark:text-sky-200',
  onHoliday: 'bg-app-surface-raised text-app-muted',
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

function LiveDistributionBar({ groups, headcount }: { groups: Record<LiveGroup, number>; headcount: number }): React.JSX.Element {
  const ORDER: LiveGroup[] = ['working', 'onBreak', 'possiblyFinished', 'onLeave', 'onHoliday', 'finished', 'notInDue', 'notInNotYetDue'];
  const segments = ORDER.filter((g) => groups[g] > 0);
  if (headcount === 0) return <></>;
  return (
    <div className="rounded-2xl border border-app-border bg-app-surface p-4" role="img" aria-label="Live workforce distribution">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-app-muted">Workforce distribution</p>
      <div className="flex h-5 w-full overflow-hidden rounded-full" aria-hidden="true">
        {segments.map((g) => (
          <div
            key={g}
            className={`${GROUP_BAR_COLORS[g]} transition-all duration-300`}
            style={{ width: `${(groups[g] / headcount) * 100}%` }}
            title={`${GROUP_LABELS[g]}: ${groups[g]}`}
          />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
        {segments.map((g) => (
          <span key={g} className="flex items-center gap-1 text-xs text-app-muted">
            <span className={`inline-block size-2 rounded-full ${GROUP_BAR_COLORS[g]}`} aria-hidden="true" />
            {groups[g]} {GROUP_LABELS[g]}
          </span>
        ))}
      </div>
      {/* Accessible data table */}
      <table className="sr-only">
        <caption>Workforce distribution breakdown</caption>
        <thead><tr><th>Group</th><th>Count</th></tr></thead>
        <tbody>
          {segments.map((g) => (
            <tr key={g}><td>{GROUP_LABELS[g]}</td><td>{groups[g]}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function stateClass(row: LiveRow): string {
  if (row.state === 'WORKING') {
    return 'bg-emerald-500/12 text-emerald-800 dark:text-emerald-200';
  }
  if (row.state === 'ON_BREAK') return 'bg-amber-500/14 text-amber-800 dark:text-amber-200';
  if (row.dayGroup === 'leave') return 'bg-sky-500/12 text-sky-800 dark:text-sky-200';
  return 'bg-app-surface-raised text-app-muted';
}

function stateLabel(row: LiveRow): string {
  if (row.state === 'WORKING') return 'Working';
  if (row.state === 'ON_BREAK') return 'On break';
  if (row.state === 'FINISHED') return 'Finished';
  if (row.dayGroup === 'leave') return 'On leave';
  if (row.dayGroup === 'holiday') return 'Holiday';
  return 'Not in';
}

function fmt(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function LiveBoardPage(): React.JSX.Element {
  const [board, setBoard] = useState<LiveBoard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [connectionFailed, setConnectionFailed] = useState(false);
  const abort = useRef<AbortController | null>(null);

  function load(): void {
    abort.current?.abort();
    abort.current = new AbortController();
    let promise: ReturnType<typeof loadLiveBoard>;
    try {
      promise = loadLiveBoard(abort.current.signal);
    } catch (err) {
      if (err instanceof Error && err.name !== 'AbortError') setError(err.message);
      return;
    }
    promise
      .then((b) => { setBoard(b); setConnectionFailed(getConnectionFailed()); })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name !== 'AbortError') setError(err.message);
      });
  }

  useEffect(() => {
    setLiveBoardRefetch(load);
    connectRealtime();
    load();
    return () => {
      abort.current?.abort();
      setLiveBoardRefetch(null);
      disconnectRealtime();
    };
  }, []);

  if (error) {
    return (
      <div className="p-6">
        <p className="text-sm text-app-danger">{error}</p>
        <button
          type="button"
          onClick={() => { setError(null); load(); }}
          className="mt-3 rounded-lg border border-app-border px-3 py-1.5 text-sm hover:border-app-accent"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!board) {
    return <div className="p-6 text-sm text-app-muted">Loading workforce board…</div>;
  }

  const groups = board.groups;
  const filtered = search.trim()
    ? board.rows.filter(
        (r) =>
          r.fullName.toLowerCase().includes(search.toLowerCase()) ||
          (r.departmentName ?? '').toLowerCase().includes(search.toLowerCase()),
      )
    : board.rows;

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <LiveDistributionBar groups={groups} headcount={board.rows.length} />

      {/* Compact summary chips */}
      <div className="flex flex-wrap gap-2">
        {(Object.entries(groups) as [LiveGroup, number][])
          .filter(([, count]) => count > 0)
          .map(([group, count]) => (
            <span
              key={group}
              className={`rounded-full px-2.5 py-1 text-xs font-semibold ${GROUP_CLASSES[group]}`}
            >
              {count} {GROUP_LABELS[group]}
            </span>
          ))}
        <span className="ml-auto flex items-center gap-2 rounded-full bg-app-surface-raised px-2.5 py-1 text-xs text-app-muted">
          {connectionFailed && <span className="inline-block size-1.5 rounded-full bg-amber-500" aria-label="Updates delayed" />}
          {board.rows.length} total
        </span>
      </div>

      {/* Search */}
      <div>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or department…"
          className="w-full max-w-sm rounded-lg border border-app-border bg-app-surface px-3 py-1.5 text-sm placeholder:text-app-muted focus:outline-none focus:ring-2 focus:ring-app-accent/30"
          aria-label="Search people"
        />
      </div>

      {/* Board table */}
      <div className="overflow-x-auto rounded-2xl border border-app-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-app-border text-left">
              <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-app-muted">Name</th>
              <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-app-muted">Department</th>
              <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-app-muted">Status</th>
              <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-app-muted">Worked</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => (
              <tr key={row.userId} className="border-b border-app-border last:border-0 hover:bg-app-surface-raised">
                <td className="px-4 py-3 font-medium">
                  {row.fullName}
                  {row.isWfh && <span className="ml-2 text-xs text-app-muted">(WFH)</span>}
                </td>
                <td className="px-4 py-3 text-app-muted">{row.departmentName ?? '—'}</td>
                <td className="px-4 py-3">
                  <span className={`rounded px-2 py-0.5 text-xs font-medium ${stateClass(row)}`}>
                    {stateLabel(row)}
                  </span>
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-app-muted">
                  {fmt(row.workedMinutes)}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-sm text-app-muted">
                  {search ? 'No people match your search.' : 'No attendance records yet today.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <button
        type="button"
        onClick={() => load()}
        className="rounded-lg border border-app-border px-3 py-1.5 text-xs text-app-muted hover:border-app-accent hover:text-app-foreground"
      >
        Refresh
      </button>
    </div>
  );
}
