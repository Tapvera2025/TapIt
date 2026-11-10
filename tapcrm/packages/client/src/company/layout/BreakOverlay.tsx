import { useCallback, useEffect, useState } from 'react';
import { Icon } from '../../ui/Icon.js';
import { loadTodayStatus, punch, type TodayStatus } from '../live/liveApi.js';

const ATTENDANCE_UPDATED_EVENT = 'tapcrm:attendance-updated';
const BREAK_LIMIT_SECONDS = 60 * 60;

function formatClock(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, '0')).join(':');
}

function elapsedSeconds(startedAt: string | null, now: number): number {
  if (!startedAt) return 0;
  return Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000));
}

export function BreakOverlay(): React.JSX.Element | null {
  const [status, setStatus] = useState<TodayStatus | null>(null);
  const [now, setNow] = useState(Date.now());
  const [resuming, setResuming] = useState(false);
  const [error, setError] = useState('');

  const refreshStatus = useCallback(async (signal?: AbortSignal) => {
    try {
      setStatus(await loadTodayStatus(signal));
    } catch {
      // The overlay can recover on its next refresh if attendance is offline.
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void refreshStatus(controller.signal);
    const poll = window.setInterval(() => void refreshStatus(), 15_000);
    const onAttendanceUpdated = () => void refreshStatus();
    window.addEventListener(ATTENDANCE_UPDATED_EVENT, onAttendanceUpdated);
    return () => {
      controller.abort();
      window.clearInterval(poll);
      window.removeEventListener(ATTENDANCE_UPDATED_EVENT, onAttendanceUpdated);
    };
  }, [refreshStatus]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const row = status?.row;
  if (row?.state !== 'ON_BREAK') return null;

  const breakElapsedSeconds = elapsedSeconds(row.since, now);
  const remainingSeconds = Math.max(0, BREAK_LIMIT_SECONDS - breakElapsedSeconds);
  const isOverLimit = breakElapsedSeconds >= BREAK_LIMIT_SECONDS;
  const isNearLimit = !isOverLimit && remainingSeconds <= 5 * 60;
  const breakState = isOverLimit ? 'over-limit' : isNearLimit ? 'near-limit' : 'within-limit';

  const resumeWork = async () => {
    setResuming(true);
    setError('');
    try {
      await punch('break-end');
      window.dispatchEvent(new Event(ATTENDANCE_UPDATED_EVENT));
      await refreshStatus();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to resume work. Please try again.');
    } finally {
      setResuming(false);
    }
  };

  return (
    <div className="break-overlay fixed inset-0 z-[100] grid place-items-center overflow-y-auto px-4 py-8" data-break-state={breakState} role="dialog" aria-modal="true" aria-labelledby="break-overlay-title">
      <div className="break-overlay-backdrop absolute inset-0" aria-hidden="true" />
      <section className="break-overlay-card relative w-full max-w-sm overflow-hidden rounded-2xl border border-app-border p-6 sm:p-7">
        <div>
          <div className="flex items-center gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-app-accent/10 text-app-accent">
              <Icon name="coffee" className="size-5" />
            </span>
            <div className="min-w-0 text-left">
              <p className="text-sm font-semibold text-app-foreground">{isOverLimit ? 'Break limit reached' : isNearLimit ? 'Break ending soon' : 'You’re on break'}</p>
              <p className="mt-0.5 text-xs text-app-muted">{isOverLimit ? 'Please resume work now. Breaks are limited to one hour.' : 'Breaks are limited to one hour.'}</p>
            </div>
          </div>
          <div className="break-overlay-timer mt-6 rounded-xl border border-app-border/70 px-4 py-5 text-center" aria-live="off">
            <p className="text-xs font-medium text-app-muted">Time on break</p>
            <p className="mt-1 font-display text-4xl font-semibold tabular-nums tracking-tight text-app-foreground sm:text-5xl">{formatClock(breakElapsedSeconds)}</p>
          </div>
          <div className="break-overlay-remaining mt-3 flex items-center justify-between gap-4 rounded-xl border border-app-border/70 bg-app-surface/45 px-4 py-3 text-left">
            <span className="text-xs font-medium text-app-muted">Time left in this break</span>
            <span className="shrink-0 text-sm font-semibold tabular-nums text-app-foreground">{isOverLimit ? '00:00' : formatClock(remainingSeconds)}</span>
          </div>

          {error && <p className="mt-4 text-sm text-app-danger" role="alert">{error}</p>}
          <button type="button" onClick={() => void resumeWork()} disabled={resuming || !status?.allowedMoves.includes('break-end')} className="break-overlay-resume mt-5 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold transition disabled:cursor-wait disabled:opacity-60">
            {resuming ? 'Resuming work…' : 'Resume work'}
          </button>
        </div>
      </section>
    </div>
  );
}
