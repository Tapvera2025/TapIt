import { useEffect, useRef, useState } from 'react';
import { loadTodayStatus, punch, type PunchKind, type LiveRow } from '../live/liveApi.js';
import { getBreakPrompts, submitBreachExplanation, type BreakPrompt } from '../api/breaksApi.js';
import { getAttendanceDayDetail, type AttendanceEventView } from '../attendance/attendanceApi.js';

// ── Formatters ───────────────────────────────────────────────────────────────

function fmtHm(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}m`;
}

function fmtTime12(value: string | Date | null): string {
  if (!value) return '—';
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

function fmtDateFull(date: Date): string {
  return date.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

function elapsedSeconds(startIso: string | null, now: Date): number {
  if (!startIso) return 0;
  return Math.max(0, Math.floor((now.getTime() - new Date(startIso).getTime()) / 1000));
}

function fmtBreakTimer(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(remaining).padStart(2, '0')}`;
}

function fmtShortDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

// ── Time-of-day ──────────────────────────────────────────────────────────────

type TimeOfDay = 'dawn' | 'morning' | 'afternoon' | 'evening' | 'night';

function getTimeOfDay(hour: number): TimeOfDay {
  if (hour >= 5 && hour < 7) return 'dawn';
  if (hour >= 7 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 20) return 'evening';
  return 'night';
}

function getGreeting(hour: number): string {
  const tod = getTimeOfDay(hour);
  if (tod === 'dawn' || tod === 'morning') return 'Good Morning,';
  if (tod === 'afternoon') return 'Good Afternoon,';
  if (tod === 'evening') return 'Good Evening,';
  return 'Good Night,';
}

function getMotivation(hour: number): string {
  const tod = getTimeOfDay(hour);
  if (tod === 'dawn' || tod === 'morning') return "Let's make it a productive day!";
  if (tod === 'afternoon') return 'Keep up the great work!';
  if (tod === 'evening') return 'Almost there — finishing strong!';
  return 'Rest well, see you tomorrow!';
}

// ── SVG Icons ────────────────────────────────────────────────────────────────

function IconClock({ className = 'h-5 w-5' }: { className?: string }): React.JSX.Element {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function IconCoffee({ className = 'h-5 w-5' }: { className?: string }): React.JSX.Element {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 8h1a4 4 0 1 1 0 8h-1" /><path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z" /><line x1="6" y1="2" x2="6" y2="4" /><line x1="10" y1="2" x2="10" y2="4" /><line x1="14" y1="2" x2="14" y2="4" />
    </svg>
  );
}

function IconCalendar({ className = 'h-5 w-5' }: { className?: string }): React.JSX.Element {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

function IconArrowRight({ className = 'h-4 w-4' }: { className?: string }): React.JSX.Element {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" />
    </svg>
  );
}

function IconLogOut({ className = 'h-4 w-4' }: { className?: string }): React.JSX.Element {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}

function IconLogIn({ className = 'h-4 w-4' }: { className?: string }): React.JSX.Element {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" /><polyline points="10 17 15 12 10 7" /><line x1="15" y1="12" x2="3" y2="12" />
    </svg>
  );
}

function IconSquare({ className = 'h-4 w-4' }: { className?: string }): React.JSX.Element {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16" rx="3" /></svg>
  );
}

function IconPlay({ className = 'h-4 w-4' }: { className?: string }): React.JSX.Element {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3" /></svg>
  );
}

// ── Greeting Card ────────────────────────────────────────────────────────────

function GreetingCard({
  row,
  allowedMoves,
  fullName,
  now,
  onPunched,
}: {
  row: LiveRow | null;
  allowedMoves: readonly string[];
  fullName: string;
  now: Date;
  onPunched: () => void;
}): React.JSX.Element {
  const hour = now.getHours();
  const [busy, setBusy] = useState<PunchKind | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const state = row?.state ?? 'NOT_IN';

  const hasIn = state === 'NOT_IN' && (allowedMoves.includes('in') || allowedMoves.includes('scan'));
  const hasOut = allowedMoves.includes('out');
  const hasBreakStart = allowedMoves.includes('break-start');
  const hasBreakEnd = allowedMoves.includes('break-end');
  const showBreakAction = state === 'WORKING' || state === 'ON_BREAK';
  const breakAction: Extract<PunchKind, 'break-start' | 'break-end'> = state === 'ON_BREAK' ? 'break-end' : 'break-start';
  const canBreak = breakAction === 'break-end' ? hasBreakEnd : hasBreakStart;

  async function handle(kind: PunchKind, label: string): Promise<void> {
    setBusy(kind);
    setMsg(null);
    try {
      const result = await punch(kind);
      const at = fmtTime12(new Date());
      setMsg(kind === 'break-start' || kind === 'break-end'
        ? null
        : { ok: true, text: result.replayed ? `${label} already recorded.` : `${label} at ${at}.` });
      onPunched();
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : 'Failed. Try again.' });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="today-greeting-card dashboard-glass dashboard-glass-surface relative flex flex-col overflow-visible rounded-2xl border border-app-border p-4 lg:h-full">
      <div className="flex min-w-0 items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-app-muted">{getGreeting(hour)}</p>
          <p className="mt-1 max-w-full break-words text-xl font-bold tracking-tight text-app-foreground sm:text-2xl">{fullName}</p>
          <p className="mt-2 text-sm text-app-muted">{getMotivation(hour)}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2 rounded-xl border border-app-border bg-app-background/50 px-3 py-2 text-xs font-semibold text-app-foreground">
          <IconCalendar className="h-3.5 w-3.5 text-app-accent" />
          {fmtDateFull(now)}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <StatusPill state={state} isWfh={row?.isWfh ?? false} />
        {(row?.shiftStartAt || row?.shiftEndAt) && (
          <span className="text-xs text-app-muted">
            Shift: {fmtTime12(row?.shiftStartAt ?? null)} – {fmtTime12(row?.shiftEndAt ?? null)}
          </span>
        )}
      </div>

      <div className="mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        <button
          type="button"
          disabled={busy !== null || !hasIn}
          onClick={() => hasIn && void handle('in', 'Punch In')}
          className={`flex items-center justify-center gap-2 rounded-xl border px-4 py-3.5 text-sm font-bold transition-all duration-150 active:scale-[0.97] ${
            hasIn
              ? 'border-app-accent bg-app-accent text-app-on-accent hover:brightness-105'
              : 'border-app-border/40 bg-white/40 text-app-muted/40 dark:bg-white/5 cursor-not-allowed'
          } disabled:cursor-not-allowed`}
        >
          <IconLogIn className={`h-4 w-4 shrink-0 ${hasIn ? 'text-app-on-accent' : 'text-app-muted/40'}`} />
          {busy === 'in' ? 'Recording…' : 'Punch In'}
        </button>
        <button
          type="button"
          disabled={busy !== null || !hasOut}
          onClick={() => hasOut && void handle('out', 'Punch Out')}
          className={`flex items-center justify-center gap-2 rounded-xl px-4 py-3.5 text-sm font-bold transition-all duration-150 active:scale-[0.97] ${
            hasOut
              ? 'border border-app-border bg-app-surface text-app-foreground hover:border-app-accent hover:text-app-accent'
              : 'border border-app-border bg-app-surface-raised text-app-muted/40 cursor-not-allowed'
          } disabled:cursor-not-allowed`}
        >
          <IconLogOut className={`h-4 w-4 shrink-0 ${hasOut ? 'text-app-on-accent' : 'text-app-muted/40'}`} />
          {busy === 'out' ? 'Recording…' : 'Punch Out'}
        </button>
      </div>

      {showBreakAction && (
        <button
          type="button"
          disabled={busy !== null || !canBreak}
          onClick={() => canBreak && void handle(breakAction, breakAction === 'break-start' ? 'Break Start' : 'Break End')}
          className={`mt-2.5 flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3.5 text-sm font-semibold transition-all active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60 ${
            breakAction === 'break-start'
              ? 'border border-app-accent/30 bg-app-accent/10 text-app-accent hover:bg-app-accent/15'
              : 'border border-app-border bg-app-surface text-app-foreground hover:border-app-accent hover:text-app-accent'
          }`}
        >
          {breakAction === 'break-start' ? <IconCoffee className="h-4 w-4" /> : <IconSquare className="h-4 w-4" />}
          {busy === 'break-start' ? 'Starting break…' : busy === 'break-end' ? 'Ending break…' : breakAction === 'break-start' ? 'Start Break' : 'End Break'}
        </button>
      )}

      <div className="mt-2 h-4 min-h-4 overflow-hidden">
        {msg && (
          <p role="status" className={`truncate text-xs font-medium ${msg.ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-app-danger'}`}>
            {msg.text}
          </p>
        )}
      </div>

    </div>
  );
}

// ── Status Pill ──────────────────────────────────────────────────────────────

function StatusPill({ state, isWfh }: { state: string; isWfh?: boolean }): React.JSX.Element {
  if (state === 'WORKING') {
    return (
      <span className="flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
        <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
        {isWfh ? 'Working from Home' : 'Currently In Office'}
      </span>
    );
  }
  if (state === 'ON_BREAK') {
    return (
      <span className="flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
        <span className="h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
        On Break
      </span>
    );
  }
  if (state === 'FINISHED') {
    return (
      <span className="flex items-center gap-1.5 rounded-full bg-app-surface-raised px-3 py-1 text-xs font-semibold text-app-muted">
        <span className="h-2 w-2 rounded-full bg-app-muted" />
        Finished
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5 rounded-full bg-app-surface-raised px-3 py-1 text-xs font-semibold text-app-muted">
      <span className="h-2 w-2 rounded-full bg-slate-400" />
      Not yet in
    </span>
  );
}

// ── Break Status Card ────────────────────────────────────────────────────────

function BreakStatusCard({
  row,
  now,
}: {
  row: LiveRow | null;
  now: Date;
}): React.JSX.Element {
  const isOnBreak = row?.state === 'ON_BREAK';
  const breakSeconds = elapsedSeconds(isOnBreak ? (row?.since ?? null) : null, now);
  const breakLimitSeconds = 60 * 60;
  const progress = Math.min(breakSeconds / breakLimitSeconds, 1);
  const circumference = 2 * Math.PI * 47;
  const strokeOffset = circumference * (1 - progress);

  return (
    <div className="today-break-status-card dashboard-glass dashboard-glass-surface flex flex-col rounded-2xl border border-app-border p-4 lg:h-full">
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-base font-bold text-app-foreground">Break Status</p>
        {isOnBreak ? (
          <span className="flex items-center gap-1.5 rounded-full bg-orange-100 px-2.5 py-1 text-xs font-semibold text-app-accent dark:bg-orange-950/40">
            <IconClock className="h-3 w-3 text-app-accent" />
            On Break
          </span>
        ) : (
          <span className="rounded-full bg-app-surface-raised px-2.5 py-1 text-xs font-medium text-app-muted">
            {row?.state === 'WORKING' ? 'Active' : row?.state === 'FINISHED' ? 'Ended' : 'Inactive'}
          </span>
        )}
      </div>

      <div className="mt-2 flex flex-1 flex-col items-center justify-center">
        <div className="today-break-timer relative grid size-28 place-items-center rounded-full sm:size-32">
          <svg className="absolute inset-0 size-full -rotate-90" viewBox="0 0 112 112" aria-hidden="true">
            <circle cx="56" cy="56" r="47" fill="none" stroke="currentColor" strokeWidth="7" className="text-app-accent/15" />
            <circle
              cx="56"
              cy="56"
              r="47"
              fill="none"
              stroke="currentColor"
              strokeWidth="7"
              strokeLinecap="round"
              className="text-app-accent transition-[stroke-dashoffset] duration-500"
              strokeDasharray={circumference}
              strokeDashoffset={strokeOffset}
            />
          </svg>
          <div className="text-center">
            <p className="text-2xl font-bold tabular-nums tracking-tight text-app-foreground">
              {isOnBreak ? fmtBreakTimer(breakSeconds) : '00:00'}
            </p>
            <p className="mt-0.5 text-[11px] font-medium text-app-muted">/ 01:00</p>
          </div>
        </div>
      </div>

      <div className="mt-3">
        <div className="rounded-xl border border-app-border bg-app-surface-raised px-2.5 py-1.5 text-center">
          <p className="text-[11px] text-app-muted">Total break today</p>
          <p className="mt-0.5 text-base font-bold tabular-nums text-app-foreground">{fmtHm(row?.breakMinutes ?? 0)}</p>
        </div>
      </div>
    </div>
  );
}

// ── Today Activity Card ──────────────────────────────────────────────────────

interface ActivityItem {
  id: string;
  time: string;
  label: string;
  sub: string;
  kind: 'in' | 'out' | 'break-start' | 'break-end' | 'current';
}

function activityIcon(kind: ActivityItem['kind']): React.JSX.Element {
  if (kind === 'in') return (
    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/30">
      <IconLogIn className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
    </div>
  );
  if (kind === 'out') return (
    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800">
      <IconLogOut className="h-4 w-4 text-slate-500" />
    </div>
  );
  if (kind === 'break-start') return (
    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-orange-100 dark:bg-orange-950/40">
      <IconCoffee className="h-4 w-4 text-app-accent" />
    </div>
  );
  if (kind === 'break-end') return (
    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900/30">
      <IconArrowRight className="h-4 w-4 text-blue-600 dark:text-blue-400" />
    </div>
  );
  // current / still-in-state
  return (
    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-app-surface-raised">
      <IconPlay className="h-4 w-4 text-app-muted" />
    </div>
  );
}

function dotColor(kind: ActivityItem['kind']): string {
  if (kind === 'in') return 'bg-emerald-500';
  if (kind === 'out') return 'bg-slate-400';
  if (kind === 'break-start') return 'bg-app-accent';
  if (kind === 'break-end') return 'bg-blue-500';
  return 'bg-slate-300';
}

function TodayActivityCard({
  items,
}: {
  items: ActivityItem[];
}): React.JSX.Element {
  const initialVisibleCount = Math.min(items.length, 3);
  const activityScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const activityList = activityScrollRef.current;
    if (!activityList || items.length <= 3) return;
    activityList.scrollTop = activityList.scrollHeight;
  }, [items.length]);

  return (
    <div className="dashboard-glass dashboard-glass-surface flex min-h-0 flex-col rounded-2xl border border-app-border p-5 lg:h-full">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 text-base font-bold text-app-foreground">Today's Activity</p>
        <span className="shrink-0 text-[11px] font-medium text-app-muted">
          Showing {initialVisibleCount} of {items.length} activit{items.length === 1 ? 'y' : 'ies'}
        </span>
      </div>

      {items.length === 0 ? (
        <div className="mt-7 flex min-h-36 flex-col items-center justify-center rounded-xl border border-dashed border-app-border bg-app-background/25 px-4 text-center">
          <span className="grid size-10 place-items-center rounded-xl bg-app-accent/10 text-app-accent">
            <IconClock className="size-5" />
          </span>
          <p className="mt-3 text-sm font-semibold text-app-foreground">No activity yet today.</p>
          <p className="mt-1 max-w-[15rem] text-xs leading-5 text-app-muted">Your punch in/out and break activity will appear here.</p>
        </div>
      ) : (
        <div ref={activityScrollRef} className="today-activity-scroll mt-4 min-h-0 max-h-[18rem] flex-1 space-y-0 overflow-y-auto overscroll-contain pr-2 lg:max-h-none">
          {items.map((item, idx) => (
            <div key={item.id} className="flex gap-3">
              {/* Left: time */}
              <div className="w-20 shrink-0 pt-1">
                <p className="text-xs font-medium tabular-nums text-app-muted">{item.time}</p>
              </div>

              {/* Center: dot + line */}
              <div className="flex flex-col items-center">
                <div className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${dotColor(item.kind)}`} />
                {idx < items.length - 1 && (
                  <div className="mt-1 flex-1 w-px bg-app-border min-h-[28px]" />
                )}
              </div>

              {/* Right: icon + text */}
              <div className="flex min-w-0 flex-1 items-start gap-3 pb-4">
                {activityIcon(item.kind)}
                <div className="min-w-0 flex-1">
                  <p className="break-words text-sm font-semibold leading-tight text-app-foreground">{item.label}</p>
                  <p className="mt-0.5 break-words text-xs text-app-muted">{item.sub}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      {items.length > 3 && (
        <p className="mt-2 text-center text-[11px] text-app-muted">Scroll to view more activity</p>
      )}
    </div>
  );
}

// ── Break Prompts ────────────────────────────────────────────────────────────

function BreakPromptsPanel({ prompts }: { prompts: BreakPrompt[] }): React.JSX.Element | null {
  const [explaining, setExplaining] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  if (prompts.length === 0) return null;

  async function handleExplain(breachId: string): Promise<void> {
    if (!note.trim()) return;
    setBusy(true);
    try {
      await submitBreachExplanation(breachId, note.trim());
      setExplaining(null); setNote('');
    } catch { /* silent */ }
    finally { setBusy(false); }
  }

  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4 dark:border-amber-800/40 dark:bg-amber-950/20">
      <p className="text-xs font-bold uppercase tracking-widest text-amber-800 dark:text-amber-300">Unanswered break prompts</p>
      <div className="mt-3 space-y-2">
        {prompts.map((p) => (
          <div key={p.breachId} className="rounded-xl bg-white/70 p-3 text-xs dark:bg-amber-900/20">
            <p className="font-medium text-amber-900 dark:text-amber-200">{p.ruleCondition}</p>
            <p className="mt-0.5 text-amber-700 dark:text-amber-400">{p.workDate}</p>
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
                  <button type="button" disabled={busy || !note.trim()} onClick={() => void handleExplain(p.breachId)}
                    className="rounded bg-amber-600 px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50">
                    {busy ? 'Saving…' : 'Submit'}
                  </button>
                  <button type="button" onClick={() => { setExplaining(null); setNote(''); }}
                    className="rounded border border-app-border px-2.5 py-1 text-xs text-app-muted">
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button type="button" onClick={() => setExplaining(p.breachId)}
                className="mt-1.5 rounded border border-amber-400 px-2 py-0.5 text-xs text-amber-700 dark:text-amber-300">
                Explain
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Activity builder ─────────────────────────────────────────────────────────

function buildActivityItems(
  events: AttendanceEventView[],
  row: LiveRow | null,
): ActivityItem[] {
  const kindMap: Record<string, ActivityItem['kind']> = {
    in: 'in', out: 'out', 'break-start': 'break-start', 'break-end': 'break-end',
  };
  const labelMap: Record<string, string> = {
    in: 'Punched In', out: 'Punched Out', 'break-start': 'Break Started', 'break-end': 'Break Ended',
  };

  const effective = events.filter((e) => !e.isVoid && kindMap[e.kind]);
  effective.sort((a, b) => {
    const ta = new Date(a.occurredAt ?? a.at ?? '').getTime();
    const tb = new Date(b.occurredAt ?? b.at ?? '').getTime();
    return ta - tb;
  });

  let workedBeforeBreak = 0;
  let lastInTime: number | null = null;

  const items: ActivityItem[] = effective.map((e) => {
    const at = e.occurredAt ?? e.at ?? null;
    const atMs = at ? new Date(at).getTime() : null;
    const kind = kindMap[e.kind]!;

    let sub = '';
    if (kind === 'in') {
      lastInTime = atMs;
      sub = row?.isWfh ? 'WFH' : 'Office';
    } else if (kind === 'break-start' && lastInTime && atMs) {
      workedBeforeBreak = Math.round((atMs - lastInTime) / 60000);
      sub = workedBeforeBreak > 0 ? `After ${fmtShortDuration(workedBeforeBreak)} of work` : '';
    } else if (kind === 'break-end' && row?.since) {
      const dur = at ? Math.round((new Date(at).getTime() - new Date(row.since).getTime()) / 60000) : 0;
      sub = dur > 0 ? `Break lasted ${fmtShortDuration(dur)}` : '';
    } else if (kind === 'out') {
      sub = `Worked ${fmtHm(row?.workedMinutes ?? 0)} total`;
    }

    return {
      id: e.id,
      time: fmtTime12(at),
      label: labelMap[e.kind] ?? e.kind,
      sub,
      kind,
    };
  });

  // Add current-state entry if still active
  if (row?.state === 'WORKING' || row?.state === 'ON_BREAK') {
    const lastKind = items.at(-1)?.kind;
    if (row.state === 'ON_BREAK' && lastKind !== 'break-start') {
      // already shown
    } else if (row.state === 'ON_BREAK') {
      items.push({
        id: 'current',
        time: fmtTime12(row.since),
        label: 'Still on Break',
        sub: 'Break in progress',
        kind: 'current',
      });
    } else if (row.state === 'WORKING' && lastKind !== 'in' && lastKind !== 'break-end') {
      items.push({
        id: 'current',
        time: fmtTime12(new Date()),
        label: 'Currently Working',
        sub: `${fmtHm(row.workedMinutes)} logged`,
        kind: 'current',
      });
    }
  }

  return items;
}

// ── Main page ────────────────────────────────────────────────────────────────

export function TodayPage({
  fullName,
  userId,
}: {
  fullName: string;
  userId: string;
}): React.JSX.Element {
  const [status, setStatus] = useState<{ row: LiveRow | null; allowedMoves: readonly string[] } | null>(null);
  const [events, setEvents] = useState<AttendanceEventView[]>([]);
  const [prompts, setPrompts] = useState<BreakPrompt[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());
  const abort = useRef<AbortController | null>(null);
  const [version, setVersion] = useState(0);

  // Tick every second
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // Load data
  useEffect(() => {
    abort.current?.abort();
    abort.current = new AbortController();
    const sig = abort.current.signal;
    const today = new Date().toISOString().slice(0, 10);

    void (async () => {
      try {
        const s = await loadTodayStatus(sig);
        setStatus(s);

        // Also load day detail for activity + shift status
        try {
          const detail = await getAttendanceDayDetail(userId, today, sig);
          setEvents(detail.events.effective);
        } catch {
          // day detail is optional — don't block on it
        }
      } catch (err) {
        if (err instanceof Error && err.name !== 'AbortError') setError(err.message);
      }
    })();

    void (async () => {
      try { setPrompts(await getBreakPrompts(sig)); } catch { /* optional */ }
    })();

    return () => { abort.current?.abort(); };
  }, [version, userId]);

  const refresh = (): void => setVersion((v) => v + 1);

  if (error) {
    return (
      <div className="p-6 text-sm text-app-danger">{error}</div>
    );
  }

  if (!status) {
    return (
      <div className="flex min-h-64 items-center justify-center p-6">
        <div className="space-y-2 text-center">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-app-accent border-t-transparent" />
          <p className="text-sm text-app-muted">Loading today's status…</p>
        </div>
      </div>
    );
  }

  const { row, allowedMoves } = status;
  const activityItems = buildActivityItems(events, row);

  return (
    <>
      <div className="min-w-0 space-y-4 p-4 sm:p-6 lg:p-4">
        <div className="grid min-h-0 grid-cols-1 gap-4 lg:h-[calc(100dvh-9rem)] lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)] lg:items-stretch">
          <div className="flex min-h-0 min-w-0 flex-col gap-4 lg:h-full">
            <div className="min-h-0 lg:flex-1">
              <GreetingCard
                row={row}
                allowedMoves={allowedMoves}
                fullName={fullName}
                now={now}
                onPunched={refresh}
              />
            </div>
            <div className="min-h-0 lg:flex-1">
              <BreakStatusCard row={row} now={now} />
            </div>
          </div>
          <div className="min-h-0 min-w-0 overflow-hidden">
            <TodayActivityCard items={activityItems} />
          </div>
        </div>

        {/* Break prompts (if any) */}
        {prompts.length > 0 && <BreakPromptsPanel prompts={prompts} />}
      </div>
    </>
  );
}
