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

function fmtElapsed(startIso: string | null, now: Date): string {
  if (!startIso) return '00:00:00';
  const diff = Math.max(0, Math.floor((now.getTime() - new Date(startIso).getTime()) / 1000));
  const h = Math.floor(diff / 3600);
  const m = Math.floor((diff % 3600) / 60);
  const s = diff % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
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
  if (tod === 'dawn' || tod === 'morning') return "Let's make it a productive day! 🚀";
  if (tod === 'afternoon') return 'Keep up the great work! 💪';
  if (tod === 'evening') return 'Almost there — finishing strong! ⭐';
  return 'Rest well, see you tomorrow! 🌙';
}

function getCardBg(hour: number): string {
  const tod = getTimeOfDay(hour);
  if (tod === 'night') return 'bg-gradient-to-br from-indigo-50 via-slate-50 to-purple-50 dark:from-indigo-950/40 dark:via-slate-900/40 dark:to-purple-950/30';
  if (tod === 'evening') return 'bg-gradient-to-br from-orange-50 via-amber-50 to-rose-50 dark:from-orange-950/40 dark:via-amber-950/30 dark:to-rose-950/20';
  if (tod === 'dawn') return 'bg-gradient-to-br from-amber-50 via-orange-50 to-yellow-50 dark:from-amber-950/40 dark:via-orange-950/30 dark:to-yellow-950/20';
  return 'bg-gradient-to-br from-orange-50 via-amber-50 to-orange-50 dark:from-orange-950/40 dark:via-amber-950/30 dark:to-orange-950/20';
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

function IconBars({ className = 'h-5 w-5' }: { className?: string }): React.JSX.Element {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" />
    </svg>
  );
}

function IconStopwatch({ className = 'h-12 w-12' }: { className?: string }): React.JSX.Element {
  return (
    <svg className={className} viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="24" cy="28" r="16" /><polyline points="24 20 24 28 29 33" /><line x1="19" y1="4" x2="29" y2="4" /><line x1="24" y1="4" x2="24" y2="8" /><line x1="38" y1="12" x2="41" y2="9" />
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

// ── Day / Night Orb ──────────────────────────────────────────────────────────

function SunSvg({ color }: { color: string }): React.JSX.Element {
  return (
    <svg viewBox="0 0 48 48" className="h-9 w-9" fill="none">
      <circle cx="24" cy="24" r="9" fill={color} />
      {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => {
        const rad = (deg * Math.PI) / 180;
        const x1 = 24 + 13 * Math.cos(rad);
        const y1 = 24 + 13 * Math.sin(rad);
        const x2 = 24 + 19 * Math.cos(rad);
        const y2 = 24 + 19 * Math.sin(rad);
        return <line key={deg} x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth="2.5" strokeLinecap="round" />;
      })}
    </svg>
  );
}

function DawnSvg(): React.JSX.Element {
  return (
    <svg viewBox="0 0 48 48" className="h-9 w-9" fill="none">
      <circle cx="24" cy="30" r="9" fill="#FDBA74" />
      {[-90, -45, 0, 45, 90].map((deg) => {
        const rad = (deg * Math.PI) / 180;
        const x1 = 24 + 13 * Math.cos(rad);
        const y1 = 30 + 13 * Math.sin(rad);
        const x2 = 24 + 19 * Math.cos(rad);
        const y2 = 30 + 19 * Math.sin(rad);
        return <line key={deg} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#FDBA74" strokeWidth="2.5" strokeLinecap="round" />;
      })}
      <line x1="6" y1="38" x2="42" y2="38" stroke="#FDBA74" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function MoonSvg(): React.JSX.Element {
  return (
    <svg viewBox="0 0 48 48" className="h-9 w-9" fill="none">
      <path d="M32 24c0 8.837-7.163 16-16 16 0 0 3 5 10 5 9 0 16-7.163 16-16S34 9 25 9c0 0 7 6.163 7 15z" fill="#94A3B8" />
      <circle cx="16" cy="12" r="1.5" fill="#CBD5E1" />
      <circle cx="10" cy="20" r="1" fill="#CBD5E1" />
      <circle cx="20" cy="8" r="1" fill="#CBD5E1" />
    </svg>
  );
}

function DayNightOrb({ hour }: { hour: number }): React.JSX.Element {
  const tod = getTimeOfDay(hour);
  const orbBg: Record<TimeOfDay, string> = {
    dawn:      'bg-amber-100 dark:bg-amber-900/50 shadow-amber-200/60 dark:shadow-amber-800/30',
    morning:   'bg-orange-100 dark:bg-orange-900/50 shadow-orange-200/60 dark:shadow-orange-800/30',
    afternoon: 'bg-amber-100 dark:bg-amber-900/50 shadow-amber-200/60 dark:shadow-amber-800/30',
    evening:   'bg-rose-100 dark:bg-rose-900/50 shadow-rose-200/60 dark:shadow-rose-800/30',
    night:     'bg-indigo-100 dark:bg-indigo-900/50 shadow-indigo-200/60 dark:shadow-indigo-800/30',
  };
  return (
    <div className={`relative flex h-16 w-16 shrink-0 items-center justify-center rounded-full shadow-lg ${orbBg[tod]}`}
         style={{ animation: 'orbPulse 3s ease-in-out infinite' }}>
      {tod === 'dawn' && <DawnSvg />}
      {tod === 'morning' && <SunSvg color="#F97316" />}
      {tod === 'afternoon' && <SunSvg color="#EAB308" />}
      {tod === 'evening' && <SunSvg color="#EA580C" />}
      {tod === 'night' && <MoonSvg />}
    </div>
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

  const hasIn = allowedMoves.includes('in') || allowedMoves.includes('scan');
  const hasOut = allowedMoves.includes('out');
  const hasBreakStart = allowedMoves.includes('break-start');
  const hasBreakEnd = allowedMoves.includes('break-end');

  async function handle(kind: PunchKind, label: string): Promise<void> {
    setBusy(kind);
    setMsg(null);
    try {
      const result = await punch(kind);
      const at = fmtTime12(new Date());
      setMsg({ ok: true, text: result.replayed ? `${label} already recorded.` : `${label} at ${at}.` });
      onPunched();
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : 'Failed. Try again.' });
    } finally {
      setBusy(null);
    }
  }

  const state = row?.state ?? 'NOT_IN';

  return (
    <div className={`rounded-2xl border border-orange-100 dark:border-orange-900/30 p-5 sm:p-6 ${getCardBg(hour)}`}>
      {/* Top: orb + greeting + date */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <DayNightOrb hour={hour} />
          <div>
            <p className="text-sm font-medium text-app-muted">{getGreeting(hour)}</p>
            <p className="text-2xl font-bold text-app-foreground">{fullName}</p>
            <p className="mt-0.5 text-sm text-app-muted">{getMotivation(hour)}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 rounded-xl border border-orange-200/60 bg-white/60 px-3 py-1.5 text-xs font-semibold text-app-foreground dark:border-orange-800/30 dark:bg-white/5">
          <IconCalendar className="h-3.5 w-3.5 text-app-accent" />
          {fmtDateFull(now)}
        </div>
      </div>

      {/* Status + shift */}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <StatusPill state={state} isWfh={row?.isWfh ?? false} />
        {(row?.shiftStartAt || row?.shiftEndAt) && (
          <span className="text-xs text-app-muted">
            Shift: {fmtTime12(row?.shiftStartAt ?? null)} – {fmtTime12(row?.shiftEndAt ?? null)}
          </span>
        )}
      </div>

      {/* Punch buttons */}
      <div className="mt-4 grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={busy !== null || !hasIn}
          onClick={() => hasIn && void handle('in', 'Punch In')}
          className={`flex items-center justify-center gap-2 rounded-xl border px-4 py-3 text-sm font-bold transition-all duration-150 active:scale-[0.97] ${
            hasIn
              ? 'border-app-border bg-white/80 text-app-foreground hover:border-app-accent dark:bg-white/10 dark:hover:border-app-accent'
              : 'border-app-border/40 bg-white/40 text-app-muted/40 dark:bg-white/5 cursor-not-allowed'
          } disabled:cursor-not-allowed`}
        >
          <IconLogIn className={`h-4 w-4 shrink-0 ${hasIn ? 'text-app-foreground' : 'text-app-muted/40'}`} />
          {busy === 'in' ? 'Recording…' : 'Punch In'}
        </button>
        <button
          type="button"
          disabled={busy !== null || !hasOut}
          onClick={() => hasOut && void handle('out', 'Punch Out')}
          className={`flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-bold transition-all duration-150 active:scale-[0.97] ${
            hasOut
              ? 'bg-app-accent text-app-on-accent hover:brightness-105 shadow-md shadow-orange-300/30 dark:shadow-orange-900/30'
              : 'bg-app-surface-raised text-app-muted/40 cursor-not-allowed'
          } disabled:cursor-not-allowed`}
        >
          <IconLogOut className={`h-4 w-4 shrink-0 ${hasOut ? 'text-app-on-accent' : 'text-app-muted/40'}`} />
          {busy === 'out' ? 'Recording…' : 'Punch Out'}
        </button>
      </div>

      {/* Break buttons (if applicable) */}
      {(hasBreakStart || hasBreakEnd) && (
        <div className="mt-2 grid grid-cols-1 gap-2">
          {hasBreakStart && (
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void handle('break-start', 'Break Start')}
              className="flex items-center justify-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm font-semibold text-amber-800 transition-all active:scale-[0.97] hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-300 disabled:opacity-60"
            >
              <IconCoffee className="h-4 w-4" />
              {busy === 'break-start' ? 'Recording…' : 'Start Break'}
            </button>
          )}
        </div>
      )}

      {msg && (
        <p role="status" className={`mt-2 text-xs font-medium ${msg.ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-app-danger'}`}>
          {msg.text}
        </p>
      )}

      {allowedMoves.length === 0 && (
        <p className="mt-4 text-center text-sm text-app-muted">You're done for today! 🎉</p>
      )}
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
  allowedMoves,
  now,
  onPunched,
}: {
  row: LiveRow | null;
  allowedMoves: readonly string[];
  now: Date;
  onPunched: () => void;
}): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const isOnBreak = row?.state === 'ON_BREAK';
  const hasBreakEnd = allowedMoves.includes('break-end');
  const elapsed = fmtElapsed(isOnBreak ? (row?.since ?? null) : null, now);

  async function endBreak(): Promise<void> {
    setBusy(true);
    setMsg(null);
    try {
      await punch('break-end');
      setMsg({ ok: true, text: 'Break ended.' });
      onPunched();
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : 'Failed.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col rounded-2xl border border-app-border bg-app-surface p-5">
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

      {/* Timer + meta */}
      <div className="mt-4 flex flex-1 items-center gap-4">
        <div className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-full ${isOnBreak ? 'bg-orange-100 dark:bg-orange-950/40' : 'bg-app-surface-raised'}`}>
          <IconStopwatch className={`h-7 w-7 ${isOnBreak ? 'text-app-accent' : 'text-app-muted'}`} />
        </div>
        <div className="flex-1">
          <p className={`text-3xl font-bold tabular-nums tracking-tight ${isOnBreak ? 'text-app-foreground' : 'text-app-muted'}`}>
            {isOnBreak ? elapsed : '—'}
          </p>
          <p className={`mt-0.5 text-sm font-medium ${isOnBreak ? 'text-app-accent' : 'text-app-muted'}`}>
            {isOnBreak ? 'On Break' : 'Not on break'}
          </p>
        </div>
        {isOnBreak && row?.since && (
          <div className="text-right">
            <p className="text-xs text-app-muted">Break Started</p>
            <p className="text-sm font-bold text-app-foreground">{fmtTime12(row.since)}</p>
          </div>
        )}
      </div>

      {/* End break / info */}
      <div className="mt-5">
        {hasBreakEnd ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void endBreak()}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-orange-200 bg-orange-50 px-4 py-3 text-sm font-bold text-app-accent transition-all active:scale-[0.97] hover:bg-orange-100 dark:border-orange-800/40 dark:bg-orange-950/30 dark:hover:bg-orange-950/50 disabled:opacity-60"
          >
            <IconSquare className="h-4 w-4 text-app-accent" />
            {busy ? 'Ending break…' : 'End Break'}
          </button>
        ) : row?.breakMinutes ? (
          <div className="rounded-xl border border-app-border bg-app-surface-raised p-3 text-center">
            <p className="text-xs text-app-muted">Total break today</p>
            <p className="mt-0.5 text-lg font-bold tabular-nums text-app-foreground">{fmtHm(row.breakMinutes)}</p>
          </div>
        ) : (
          <div className="rounded-xl border border-app-border bg-app-surface-raised p-3 text-center text-xs text-app-muted">
            No breaks taken yet
          </div>
        )}
        {msg && (
          <p className={`mt-2 text-center text-xs font-medium ${msg.ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-app-danger'}`}>
            {msg.text}
          </p>
        )}
      </div>
    </div>
  );
}

// ── Today Stats Card ─────────────────────────────────────────────────────────

function TodayStatsCard({
  row,
  breakCount,
  shiftStatus,
}: {
  row: LiveRow | null;
  breakCount: number;
  shiftStatus: string | null;
}): React.JSX.Element {
  const worked = row?.workedMinutes ?? 0;
  const breaks = row?.breakMinutes ?? 0;
  const shiftStart = row?.shiftStartAt ?? null;
  const shiftEnd = row?.shiftEndAt ?? null;

  const isOnTrack = shiftStatus === 'on-time' || shiftStatus === null && worked > 0;
  const statusLabel =
    shiftStatus === 'on-time' ? 'On Time' :
    shiftStatus === 'late' ? 'Late' :
    shiftStatus === 'early-exit' ? 'Early Exit' :
    shiftStatus === 'absent' ? 'Absent' :
    row?.state === 'WORKING' ? 'On Time' :
    row?.state === 'ON_BREAK' ? 'On Break' :
    '—';

  const statItems = [
    {
      icon: <IconClock className="h-5 w-5 text-app-accent" />,
      label: 'Total Working Hours',
      value: fmtHm(worked),
      sub: null,
    },
    {
      icon: <IconCoffee className="h-5 w-5 text-app-accent" />,
      label: 'Total Break Time',
      value: fmtHm(breaks),
      sub: breakCount > 0 ? `${breakCount} break${breakCount > 1 ? 's' : ''}` : null,
    },
    {
      icon: <IconCalendar className="h-5 w-5 text-app-accent" />,
      label: 'Expected Shift',
      value: (shiftStart || shiftEnd) ? `${fmtTime12(shiftStart)} – ${fmtTime12(shiftEnd)}` : '—',
      sub: null,
    },
    {
      icon: <IconBars className="h-5 w-5 text-app-accent" />,
      label: 'Shift Status',
      value: statusLabel,
      isStatus: true,
      onTrack: isOnTrack,
    },
  ];

  return (
    <div className="rounded-2xl border border-app-border bg-app-surface p-5">
      <div className="flex items-center justify-between">
        <p className="text-base font-bold text-app-foreground">Today's Status</p>
        {row && row.state !== 'NOT_IN' && (
          <span className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${
            isOnTrack
              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
              : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
          }`}>
            <span className={`h-2 w-2 rounded-full ${isOnTrack ? 'bg-emerald-500' : 'bg-amber-500'}`} />
            {isOnTrack ? 'On Track' : 'Off Track'}
          </span>
        )}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        {statItems.map((item) => (
          <div key={item.label} className="flex items-start gap-3 rounded-xl border border-app-border bg-app-surface-raised/40 p-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-orange-100 dark:bg-orange-950/30">
              {item.icon}
            </div>
            <div className="min-w-0">
              <p className="text-xs text-app-muted leading-tight">{item.label}</p>
              {'isStatus' in item && item.isStatus ? (
                <p className={`mt-1 text-base font-bold flex items-center gap-1.5 ${item.onTrack ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
                  <span className={`h-2 w-2 rounded-full ${item.onTrack ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                  {item.value}
                </p>
              ) : (
                <p className="mt-1 text-base font-bold tabular-nums text-app-foreground">{item.value}</p>
              )}
              {item.sub && <p className="text-[11px] text-app-muted mt-0.5">{item.sub}</p>}
            </div>
          </div>
        ))}
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
  onViewAll,
}: {
  items: ActivityItem[];
  onViewAll?: () => void;
}): React.JSX.Element {
  return (
    <div className="rounded-2xl border border-app-border bg-app-surface p-5">
      <div className="flex items-center justify-between">
        <p className="text-base font-bold text-app-foreground">Today's Activity</p>
        {onViewAll && (
          <button
            type="button"
            onClick={onViewAll}
            className="flex items-center gap-1 text-xs font-semibold text-app-accent hover:underline"
          >
            View All <IconArrowRight className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {items.length === 0 ? (
        <div className="mt-6 text-center text-sm text-app-muted">No activity yet today.</div>
      ) : (
        <div className="mt-4 space-y-0">
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
              <div className="flex flex-1 items-start gap-3 pb-4">
                {activityIcon(item.kind)}
                <div>
                  <p className="text-sm font-semibold text-app-foreground leading-tight">{item.label}</p>
                  <p className="mt-0.5 text-xs text-app-muted">{item.sub}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
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
  const [shiftStatus, setShiftStatus] = useState<string | null>(null);
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
          setShiftStatus(detail.record.status ?? null);
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
  const breakCount = events.filter((e) => !e.isVoid && e.kind === 'break-start').length;
  const activityItems = buildActivityItems(events, row);

  return (
    <>
      <style>{`
        @keyframes orbPulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(249, 115, 22, 0.3); }
          50% { box-shadow: 0 0 0 10px rgba(249, 115, 22, 0); }
        }
      `}</style>

      <div className="space-y-4 p-4 sm:p-6">
        {/* Row 1: Greeting + Break Status */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <GreetingCard
              row={row}
              allowedMoves={allowedMoves}
              fullName={fullName}
              now={now}
              onPunched={refresh}
            />
          </div>
          <div>
            <BreakStatusCard
              row={row}
              allowedMoves={allowedMoves}
              now={now}
              onPunched={refresh}
            />
          </div>
        </div>

        {/* Row 2: Today's Status + Today's Activity */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <TodayStatsCard
            row={row}
            breakCount={breakCount}
            shiftStatus={shiftStatus}
          />
          <TodayActivityCard items={activityItems} />
        </div>

        {/* Break prompts (if any) */}
        {prompts.length > 0 && <BreakPromptsPanel prompts={prompts} />}
      </div>
    </>
  );
}
