import { useEffect, useRef, useState } from 'react';
import { loadTodayStatus, type TodayStatus } from '../live/liveApi.js';
import { getBreakAllowance, getBreakPrompts, submitBreachExplanation, type BreakAllowance, type BreakPrompt } from '../api/breaksApi.js';

function fmt(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function fmtTime(value: Date | string | null): string {
  if (!value) return '—';
  const d = value instanceof Date ? value : new Date(value);
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function StateChip({ state }: { state: string }): React.JSX.Element {
  const classes: Record<string, string> = {
    WORKING: 'bg-emerald-500/12 text-emerald-800 dark:text-emerald-200',
    ON_BREAK: 'bg-amber-500/14 text-amber-800 dark:text-amber-200',
    FINISHED: 'bg-app-surface-raised text-app-muted',
    NOT_IN: 'bg-app-surface-raised text-app-muted',
  };
  const labels: Record<string, string> = {
    WORKING: 'Working', ON_BREAK: 'On break', FINISHED: 'Finished', NOT_IN: 'Not in',
  };
  return (
    <span className={`rounded-full px-3 py-1 text-sm font-semibold ${classes[state] ?? classes['NOT_IN']}`}>
      {labels[state] ?? state}
    </span>
  );
}

function StatBox({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="rounded-xl bg-app-surface-raised p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-app-muted">{label}</p>
      <p className="mt-1 text-xl font-bold tabular-nums">{value}</p>
    </div>
  );
}

function fmtMins(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function BreakAllowancePanel({ allowance, prompts }: { allowance: BreakAllowance; prompts: BreakPrompt[] }): React.JSX.Element {
  const [explaining, setExplaining] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const warningState = allowance.warning.totalState;
  const barColor = warningState === 'breach' ? 'bg-rose-500' : warningState === 'warning' ? 'bg-amber-500' : 'bg-emerald-500';
  const usedTotal = allowance.usage.totalMinutes;
  const maxTotal = allowance.policy?.upperTotalMinutes ?? null;
  const pct = maxTotal ? Math.min(100, Math.round((usedTotal / maxTotal) * 100)) : null;

  async function handleExplain(breachId: string): Promise<void> {
    if (!note.trim()) return;
    setBusy(true);
    try {
      await submitBreachExplanation(breachId, note.trim());
      setExplaining(null); setNote('');
    } catch { /* ignore */ }
    finally { setBusy(false); }
  }

  return (
    <div className="rounded-2xl border border-app-border bg-app-surface p-4 space-y-3">
      <p className="text-xs font-semibold uppercase tracking-widest text-app-muted">Break allowance</p>
      {allowance.noPolicy ? (
        <p className="text-sm text-app-muted">No break policy assigned for today.</p>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="tabular-nums">{fmtMins(usedTotal)} used</span>
            {maxTotal !== null && <span className="text-app-muted tabular-nums">of {fmtMins(maxTotal)}</span>}
          </div>
          {pct !== null && (
            <div className="h-2 w-full overflow-hidden rounded-full bg-app-surface-raised">
              <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
            </div>
          )}
          {allowance.remaining.totalMinutes !== null && (
            <p className="text-xs text-app-muted">{fmtMins(allowance.remaining.totalMinutes)} remaining</p>
          )}
        </div>
      )}

      {prompts.length > 0 && (
        <div className="space-y-2 border-t border-app-border pt-3">
          <p className="text-xs font-semibold text-amber-800 dark:text-amber-200">Unanswered prompts</p>
          {prompts.map((p) => (
            <div key={p.breachId} className="rounded-xl bg-amber-500/8 p-3 text-xs">
              <p className="font-medium text-amber-900 dark:text-amber-200">{p.ruleCondition}</p>
              <p className="mt-0.5 text-amber-700 dark:text-amber-300">{p.workDate}</p>
              {explaining === p.breachId ? (
                <div className="mt-2 space-y-1.5">
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    rows={2}
                    placeholder="Explain the situation…"
                    className="w-full rounded-lg border border-app-border bg-app-surface px-2 py-1 text-xs"
                  />
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      disabled={busy || !note.trim()}
                      onClick={() => void handleExplain(p.breachId)}
                      className="rounded bg-amber-600 px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50"
                    >
                      {busy ? 'Saving…' : 'Submit'}
                    </button>
                    <button
                      type="button"
                      onClick={() => { setExplaining(null); setNote(''); }}
                      className="rounded border border-app-border px-2.5 py-1 text-xs text-app-muted"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setExplaining(p.breachId)}
                  className="mt-1.5 rounded border border-amber-400 px-2 py-0.5 text-xs text-amber-700 dark:text-amber-300"
                >
                  Explain
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function TodayPage(): React.JSX.Element {
  const [status, setStatus] = useState<TodayStatus | null>(null);
  const [allowance, setAllowance] = useState<BreakAllowance | null>(null);
  const [prompts, setPrompts] = useState<BreakPrompt[]>([]);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    abort.current = new AbortController();
    const sig = abort.current.signal;
    loadTodayStatus(sig)
      .then(setStatus)
      .catch((err: unknown) => {
        if (err instanceof Error && err.name !== 'AbortError') setError(err.message);
      });
    getBreakAllowance(sig)
      .then(setAllowance)
      .catch(() => undefined);
    getBreakPrompts(sig)
      .then(setPrompts)
      .catch(() => undefined);
    return () => { abort.current?.abort(); };
  }, []);

  if (error) {
    return (
      <div className="p-6">
        <p className="text-sm text-app-danger">{error}</p>
      </div>
    );
  }

  if (!status) {
    return <div className="p-6 text-sm text-app-muted">Loading today's status…</div>;
  }

  const { row } = status;

  if (!row) {
    return (
      <div className="mx-auto max-w-lg p-4 sm:p-6">
        <div className="rounded-2xl border border-app-border bg-app-surface p-5 text-center">
          <p className="text-sm text-app-muted">No attendance record yet for today.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg space-y-4 p-4 sm:p-6">
      {/* Status card */}
      <div className="rounded-2xl border border-app-border bg-app-surface p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-app-muted">Today</p>
            <p className="mt-1 text-base font-semibold tabular-nums">{row.workDate}</p>
          </div>
          <StateChip state={row.state} />
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <StatBox label="Worked" value={fmt(row.workedMinutes)} />
          <StatBox label="Break" value={fmt(row.breakMinutes)} />
          {(row.shiftStartAt || row.shiftEndAt) && (
            <StatBox
              label="Shift"
              value={`${fmtTime(row.shiftStartAt)}–${fmtTime(row.shiftEndAt)}`}
            />
          )}
        </div>

        {row.isWfh && (
          <p className="mt-3 text-xs text-app-muted">Working from home today</p>
        )}
        {row.dayGroup === 'leave' && (
          <p className="mt-3 text-xs text-app-muted">On approved leave</p>
        )}
        {row.dayGroup === 'holiday' && (
          <p className="mt-3 text-xs text-app-muted">Holiday</p>
        )}
        {row.presenceConfidence === 'assumed' && (
          <p className="mt-3 text-xs text-app-muted">Presence assumed — scan not confirmed</p>
        )}
      </div>

      {allowance && <BreakAllowancePanel allowance={allowance} prompts={prompts} />}

      {/* Punch panel — G1 gate not yet open */}
      <div className="rounded-2xl border border-app-border bg-app-surface p-4">
        <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-app-muted">Punch</p>
        <p className="text-sm text-app-muted">
          Manual punch is not available in this version. Your status updates through
          device scans.
        </p>
      </div>
    </div>
  );
}
