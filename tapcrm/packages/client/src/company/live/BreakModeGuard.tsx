import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getAttendanceDayDetail } from '../attendance/attendanceApi.js';
import { exactCompletedBreakSeconds } from '../attendance/breakTime.js';
import { getBreakAllowance } from '../api/breaksApi.js';
import { ATTENDANCE_UPDATED_EVENT, loadTodayStatus, notifyAttendanceUpdated, punch } from './liveApi.js';
import './break-mode-guard.css';

function formatBreakTime(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function BreakTimer({ totalBreakSeconds, limitMinutes }: { totalBreakSeconds: number; limitMinutes: number }): React.JSX.Element {
  const limitSeconds = limitMinutes * 60;
  const isOverLimit = totalBreakSeconds > limitSeconds;
  const overtimeSeconds = Math.max(0, totalBreakSeconds - limitSeconds);
  const radius = 47;
  const circumference = 2 * Math.PI * radius;
  const progress = Math.min(totalBreakSeconds / limitSeconds, 1);

  return (
    <div
      className="break-mode-timer"
      data-over-limit={isOverLimit ? 'true' : 'false'}
      role="timer"
      aria-live="off"
      aria-label={`Break time used today ${formatBreakTime(totalBreakSeconds)} of ${limitMinutes} minutes${isOverLimit ? (overtimeSeconds > 0 ? `, over by ${formatBreakTime(overtimeSeconds)}` : ', allowance reached') : ''}`}
    >
      <svg className="break-mode-timer-ring" viewBox="0 0 112 112" aria-hidden="true">
        <circle cx="56" cy="56" r={radius} className="break-mode-timer-track" />
        <circle
          cx="56"
          cy="56"
          r={radius}
          className="break-mode-timer-progress"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - progress)}
        />
      </svg>
      <div className="break-mode-timer-copy">
        <span className="break-mode-timer-caption">
          TOTAL TODAY
        </span>
        <span className="break-mode-timer-value">{formatBreakTime(totalBreakSeconds)}</span>
        <span className="break-mode-timer-limit">
          {isOverLimit
            ? (overtimeSeconds > 0 ? `${formatBreakTime(overtimeSeconds)} over ${limitMinutes}m limit` : 'Allowance reached')
            : `of ${limitMinutes} min`}
        </span>
      </div>
    </div>
  );
}

type BreakMood = 'tired' | 'recovering' | 'ready' | 'rushed';

const BREAK_MOOD_LABEL: Record<BreakMood, string> = {
  tired: 'Taking a breather',
  recovering: 'Recharging',
  ready: 'Ready to go',
  rushed: 'Time to head back',
};

function BreakCompanion({ mood }: { mood: BreakMood }): React.JSX.Element {
  const isTired = mood === 'tired';
  const isRecovering = mood === 'recovering';
  const isReady = mood === 'ready';
  const isRushed = mood === 'rushed';

  return (
    <div className="break-mode-companion" data-mood={mood} role="img" aria-label={`TapCRM companion: ${BREAK_MOOD_LABEL[mood]}`}>
      <svg className="break-mode-companion-art" viewBox="0 0 180 220" aria-hidden="true">
        <defs>
          <linearGradient id="companion-skin" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#f2bd8e" />
            <stop offset=".55" stopColor="#df9868" />
            <stop offset="1" stopColor="#c97950" />
          </linearGradient>
          <linearGradient id="companion-shirt" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#3576c6" />
            <stop offset=".52" stopColor="#245ca8" />
            <stop offset="1" stopColor="#18467f" />
          </linearGradient>
          <linearGradient id="companion-jeans" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#26466a" />
            <stop offset=".48" stopColor="#355d82" />
            <stop offset="1" stopColor="#203d60" />
          </linearGradient>
          <linearGradient id="companion-hair" x1="0" y1="0" x2=".7" y2="1">
            <stop offset="0" stopColor="#34302d" />
            <stop offset=".55" stopColor="#171b22" />
            <stop offset="1" stopColor="#10151d" />
          </linearGradient>
          <radialGradient id="companion-face-light" cx="36%" cy="28%" r="78%">
            <stop offset="0" stopColor="#ffd5aa" stopOpacity=".72" />
            <stop offset="1" stopColor="#d8875d" stopOpacity="0" />
          </radialGradient>
        </defs>
        {isRushed && (
          <g className="break-mode-speed-lines" fill="none" stroke="currentColor" strokeLinecap="round">
            <path d="M17 76h24M10 91h30M16 106h22" />
            <path d="M141 59h21M145 75h25M143 91h22" />
          </g>
        )}
        {isReady && (
          <g className="break-mode-sparkles" fill="none" stroke="currentColor" strokeLinecap="round">
            <path d="M23 55v14m-7-7h14M153 101v12m-6-6h12M142 38v9m-4.5-4.5h9" />
          </g>
        )}
        <ellipse cx="90" cy="209" rx="31" ry="5" fill="#172033" opacity=".13" />
        <g className="break-mode-companion-person">
          {/* A softly shaded face and neck keep the character warm rather than icon-flat. */}
          <path d="M79 79h22v22q-10 9-22 0Z" fill="url(#companion-skin)" />
          <path d="M82 85q8 6 17 0v9q-8 6-17 0Z" fill="#a95e42" opacity=".2" />

          {/* Arms sit behind the shirt; each pose changes the hands and shoulders. */}
          {isReady ? (
            <g fill="none" stroke="url(#companion-skin)" strokeWidth="15" strokeLinecap="round" strokeLinejoin="round">
              <path d="M62 123Q49 118 43 96L38 76" />
              <path d="M118 123Q132 119 135 128L136 151" />
            </g>
          ) : isRushed ? (
            <g fill="none" stroke="url(#companion-skin)" strokeWidth="15" strokeLinecap="round" strokeLinejoin="round">
              <path d="M62 123Q48 117 44 91L49 73" />
              <path d="M118 123Q132 117 136 91L131 73" />
            </g>
          ) : isTired ? (
            <g fill="none" stroke="url(#companion-skin)" strokeWidth="15" strokeLinecap="round" strokeLinejoin="round">
              <path d="M62 123Q50 126 49 136L62 140" />
              <path d="M118 123Q130 126 131 136L118 140" />
            </g>
          ) : (
            <g fill="none" stroke="url(#companion-skin)" strokeWidth="15" strokeLinecap="round" strokeLinejoin="round">
              <path d="M62 123Q55 128 56 137L57 154" />
              <path d="M118 123Q125 128 124 137L123 154" />
            </g>
          )}

          {/* Jeans and shoes with seams, creases and soft side shading. */}
          <g transform="translate(0 150) scale(1 1.12) translate(0 -150)">
            <path d="M60 148Q90 155 120 148L117 183 121 198 104 201 94 190 91 165 87 190 78 201 60 198 65 181Z" fill="url(#companion-jeans)" />
            <path d="M88 157 87 188m7-29 2 30M66 178q8 3 15 1m23-1q6 2 11 0" fill="none" stroke="#a9c2d8" strokeWidth="1.3" opacity=".35" />
            <path d="M58 195q10 4 21-1l-2 9q-9 5-23 0l-2-3q1-3 6-5ZM103 194q9 5 19 0l6 6q-7 8-22 4l-5-5Z" fill="#24272d" />
            <path d="M56 201q10 3 20 0m30 1q10 3 18 0" fill="none" stroke="#d4d7d9" strokeWidth="1.5" strokeLinecap="round" opacity=".75" />
          </g>

          {/* Polo shirt, collar and small fabric folds. */}
          <path d="M72 91Q80 86 90 88q10-2 18 3l13 9-5 15 3 32q-28 9-58 0l3-32-5-15Z" fill="url(#companion-shirt)" />
          <path d="M72 91 60 99Q48 105 46 117l16 10q2-12 10-22Zm36 0 12 8q12 6 14 18l-16 10q-2-12-10-22Z" fill="#2b68b2" />
          <path d="m77 89 13 3-8 10-7-8Zm26 0-13 3 8 10 7-8Z" fill="#48a879" />
          <path d="M88 100h5v17h-5Z" fill="#247e60" />
          <path d="M89 101h1.2v15H89Z" fill="#64b98c" opacity=".75" />
          <circle cx="91" cy="106" r="1.1" fill="#d5efe0" /><circle cx="91" cy="112" r="1.1" fill="#d5efe0" />
          <path d="M49 116q6 4 13 5m56 0q7-1 13-5" fill="none" stroke="#47a879" strokeWidth="2.4" opacity=".9" />
          <path d="M63 119q3 12 1 24m52-24q-3 12-1 24M74 143q16 4 33 0" fill="none" stroke="#87acd2" strokeWidth="1.3" opacity=".35" />
          <path d="M76 146q14 3 29 0v7q-15 4-30 0Z" fill="#59452f" />
          <rect x="87" y="147" width="8" height="7" rx="1" fill="#d6b76e" />

          {/* Pose-specific hands; the open fingers give the ready/rushed states life. */}
          {isReady ? (
            <g fill="url(#companion-skin)" stroke="#b9704d" strokeWidth="1.1" strokeLinejoin="round">
              <path d="M33 76q-4-1-4-6l2-12q.5-3 3-2t2 5l.3-11q.2-3 3-3t2.5 3l.5 10 2-8q1-3 3-2t1.5 4l-1 9 3-4q2-2 3.5 0t-1 5l-5 11q-4 6-10 3Z" />
              <path d="M131 153q7-4 11 2l3 5q2 4-2 6t-8 1q-6-1-8-5Z" />
            </g>
          ) : isRushed ? (
            <g fill="url(#companion-skin)" stroke="#b9704d" strokeWidth="1.1" strokeLinejoin="round">
              <path d="M45 75q-4-1-4-6l2-11q.5-3 3-2t2 5l.3-10q.2-3 3-3t2.5 3l.5 9 2-7q1-3 3-2t1.5 4l-1 8 3-4q2-2 3.5 0t-1 5l-5 10q-4 6-10 3Z" />
              <path d="M134 75q-4 0-4-5l1-11q.5-3 3-2t2 5l.3-10q.2-3 3-3t2.5 3l.5 9 2-7q1-3 3-2t1.5 4l-1 8 3-4q2-2 3.5 0t-1 5l-5 10q-4 6-10 3Z" />
            </g>
          ) : isTired ? (
            <g fill="url(#companion-skin)" stroke="#b9704d" strokeWidth="1.1" strokeLinejoin="round">
              <path d="M58 136q5-3 9 1l7 6q3 3 0 6t-7 0l-8-5q-4-3-1-8Zm64 0q-5-3-9 1l-7 6q-3 3 0 6t7 0l8-5q4-3 1-8Z" />
            </g>
          ) : (
            <g fill="url(#companion-skin)" stroke="#b9704d" strokeWidth="1.1" strokeLinejoin="round">
              <path d="M50 151q4 2 8 2l4 5q3 3 2 7l-2 4q-2 2-4-1l-2-3q-1 4-4 3l-3-5q-3 1-4-2l1-5q-3-3 0-5Z" />
              <path d="M130 151q-4 2-8 2l-4 5q-3 3-2 7l2 4q2 2 4-1l2-3q1 4 4 3l3-5q3 1 4-2l-1-5q3-3 0-5Z" />
              <path d="M49 159q3 2 4 5m2-8q3 2 4 5m1-4 2 3m71-1q-3 2-4 5m-2-8q-3 2-4 5m-1-4-2 3" fill="none" stroke="#a85e43" strokeWidth=".9" strokeLinecap="round" />
            </g>
          )}

          {/* Ears and face: a slightly smaller head brings the figure closer to adult proportions. */}
          <g transform="translate(0 58) scale(1 .75) translate(0 -58)">
          <ellipse cx="63" cy="57" rx="7" ry="9" fill="url(#companion-skin)" />
          <ellipse cx="117" cy="57" rx="7" ry="9" fill="url(#companion-skin)" />
          <path d="M60 56q3-4 5 1m50-1q3-5 6-1" fill="none" stroke="#a95e42" strokeWidth="1.5" strokeLinecap="round" opacity=".65" />
          <path d="M64 52Q64 28 90 28t26 24l-2 20q-2 19-24 22-22-3-24-22Z" fill="url(#companion-skin)" />
          <path d="M64 52Q64 28 90 28t26 24l-2 20q-2 19-24 22-22-3-24-22Z" fill="url(#companion-face-light)" />
          <path d="M67 70q2 13 11 17m35-17q-2 13-11 17" fill="none" stroke="#b96e4b" strokeWidth="1.1" opacity=".32" />
          <path d="M73 68q5 4 10 1m14 0q5 3 10-1" fill="none" stroke="#bd704c" strokeWidth="2" opacity=".2" />
          <path d="M79 77q4 2 8 0m9 0q4 2 8 0" fill="none" stroke="#cc7c56" strokeWidth="2.4" strokeLinecap="round" opacity=".35" />

          {/* One continuous hair silhouette keeps the crown and side-swept fringe aligned. */}
          <path d="M64 56C60 49 60 42 62 35c2-9 10-14 19-15 8-5 17-4 22 0 10 0 16 8 16 17 2 8 0 15-3 21-5-3-9-7-12-12-6 6-14 9-22 8-6-1-11-4-15-9-1 4-2 8-3 11Z" fill="url(#companion-hair)" />
          <path d="M72 31q5-8 14-9m6-1q8-2 14 3m5 3q5 3 6 8" fill="none" stroke="#756459" strokeWidth="2.1" strokeLinecap="round" opacity=".45" />

          {/* Brows, eyes and mouth subtly change with the break mood. */}
          {isTired ? (
            <g fill="none" stroke="#29221f" strokeWidth="2.8" strokeLinecap="round">
              <path d="M76 54q5-3 10 0m10 0q5-3 10 0" />
              <path d="M76 59q5-2 10 1m10-1q5-2 10 1" strokeWidth="2.1" />
            </g>
          ) : isRecovering ? (
            <g fill="none" stroke="#29221f" strokeWidth="2.5" strokeLinecap="round">
              <path d="M77 54q4-2 8 0m10 0q4-2 8 0" />
              <path d="M77 60q5 5 9 0m10 0q5 5 9 0" strokeWidth="2.2" />
            </g>
          ) : (
            <g>
              <path d={isRushed ? 'M76 52q5-3 10 0m10 0q5-3 10 0' : 'M77 53q4-2 8 0m10 0q4-2 8 0'} fill="none" stroke="#29221f" strokeWidth="2.8" strokeLinecap="round" />
              <ellipse cx="82" cy="60" rx={isRushed ? 4.8 : 4.2} ry={isRushed ? 5.6 : 4.8} fill="#fffaf2" />
              <ellipse cx="99" cy="60" rx={isRushed ? 4.8 : 4.2} ry={isRushed ? 5.6 : 4.8} fill="#fffaf2" />
              <circle cx="83" cy="60.5" r="2.5" fill="#283442" />
              <circle cx="100" cy="60.5" r="2.5" fill="#283442" />
              <circle cx="83.8" cy="59.7" r=".8" fill="#fff" />
              <circle cx="100.8" cy="59.7" r=".8" fill="#fff" />
            </g>
          )}
          <path d="M90 59q-1 8-4 12 3 2 6 0" fill="none" stroke="#a85e43" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" opacity=".78" />
          {isTired ? (
            <path d="M85 79q5-5 10 0" fill="none" stroke="#754039" strokeWidth="2.4" strokeLinecap="round" />
          ) : isRushed ? (
            <ellipse cx="90" cy="78" rx="3.5" ry="4.7" fill="#773e37" />
          ) : isReady ? (
            <path d="M84 76q6 9 13 0" fill="#fff6e9" stroke="#74463c" strokeWidth="2" strokeLinecap="round" />
          ) : (
            <path d="M85 77q5 6 10 0" fill="none" stroke="#754039" strokeWidth="2.3" strokeLinecap="round" />
          )}
          {isTired && <path d="M121 61q7 4 1 11-6 4-4-2 3-4 3-9Z" fill="#70b8cf" stroke="#e9f6f8" strokeWidth="1" />}
          {isReady && <path d="M49 79q-4-7 1-11 5 3 1 11m75-3q4-7 8-5 1 6-8 5Z" fill="#f1bd69" opacity=".9" />}
          </g>
        </g>
      </svg>
      <span className="break-mode-companion-caption">{BREAK_MOOD_LABEL[mood]}</span>
    </div>
  );
}

/** Keeps the CRM behind a resume prompt for as long as the server says the user is on break. */
export function BreakModeGuard(): React.JSX.Element | null {
  const [onBreak, setOnBreak] = useState(false);
  const [breakStartedAt, setBreakStartedAt] = useState<string | null>(null);
  const [completedBreakSeconds, setCompletedBreakSeconds] = useState(0);
  const [breakLimitMinutes, setBreakLimitMinutes] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [readyToReturn, setReadyToReturn] = useState(false);
  const [resuming, setResuming] = useState(false);
  const [error, setError] = useState('');
  const dialogRef = useRef<HTMLDialogElement>(null);
  const statusRequestRef = useRef(0);

  const refreshStatus = useCallback(async () => {
    const request = ++statusRequestRef.current;
    try {
      const status = await loadTodayStatus();
      const row = status.row;
      const active = row?.state === 'ON_BREAK';
      const startedAt = active ? row?.since ?? row?.lastEventAt ?? null : null;
      const startedAtMs = startedAt ? Date.parse(startedAt) : Number.NaN;
      const activeElapsed = Number.isFinite(startedAtMs)
        ? Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000))
        : 0;
      const reportedTotalSeconds = Math.max(0, row?.breakMinutes ?? 0) * 60;

      if (request === statusRequestRef.current) {
        setOnBreak(active);
        setBreakStartedAt(startedAt);
        // The live projection includes an open break, so remove its elapsed portion here.
        // This provides a useful value immediately while exact event timestamps load.
        setCompletedBreakSeconds(active
          ? Math.max(0, reportedTotalSeconds - activeElapsed)
          : reportedTotalSeconds);
      }

      if (row) {
        try {
          const detail = await getAttendanceDayDetail(row.userId, row.workDate);
          if (request === statusRequestRef.current) {
            setCompletedBreakSeconds(exactCompletedBreakSeconds(detail.events.effective));
          }
        } catch {
          // Keep the rounded live projection fallback if exact event history is unavailable.
        }
      }
    } catch {
      // A transient status failure should not dismiss a break already in progress.
    }
  }, []);

  useEffect(() => {
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void refreshStatus();
    };
    void refreshStatus();
    window.addEventListener(ATTENDANCE_UPDATED_EVENT, refreshWhenVisible);
    window.addEventListener('focus', refreshWhenVisible);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    const interval = window.setInterval(refreshWhenVisible, 45_000);
    return () => {
      statusRequestRef.current += 1;
      window.removeEventListener(ATTENDANCE_UPDATED_EVENT, refreshWhenVisible);
      window.removeEventListener('focus', refreshWhenVisible);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
      window.clearInterval(interval);
    };
  }, [refreshStatus]);

  useEffect(() => {
    if (!onBreak) {
      setBreakLimitMinutes(null);
      return;
    }

    let current = true;
    void getBreakAllowance().then((allowance) => {
      if (!current) return;
      const configuredLimit = allowance.policy?.upperTotalMinutes ?? allowance.policy?.upperSingleMinutes;
      setBreakLimitMinutes(configuredLimit !== null && configuredLimit !== undefined && configuredLimit > 0 ? configuredLimit : 60);
    }).catch(() => {
      // Keep the same one-hour fallback used by the attendance break timer.
      if (current) setBreakLimitMinutes(60);
    });
    return () => { current = false; };
  }, [onBreak]);

  useEffect(() => {
    if (!onBreak) return;
    const updateClock = () => setNowMs(Date.now());
    updateClock();
    const interval = window.setInterval(updateClock, 1000);
    return () => window.clearInterval(interval);
  }, [onBreak]);

  useEffect(() => {
    if (!onBreak) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) {
      dialog.showModal();
      dialog.querySelector<HTMLElement>('#break-mode-title')?.focus({ preventScroll: true });
    }

    const preventBackgroundScroll = (event: WheelEvent | TouchEvent) => {
      if (event.target instanceof Node && dialog.contains(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
    };
    document.addEventListener('wheel', preventBackgroundScroll, { capture: true, passive: false });
    document.addEventListener('touchmove', preventBackgroundScroll, { capture: true, passive: false });
    return () => {
      document.removeEventListener('wheel', preventBackgroundScroll, true);
      document.removeEventListener('touchmove', preventBackgroundScroll, true);
      if (dialog.open) dialog.close();
    };
  }, [onBreak]);

  const resume = async (): Promise<void> => {
    setResuming(true);
    setError('');
    setReadyToReturn(false);
    try {
      await punch('break-end');
      setReadyToReturn(true);
      await new Promise<void>((resolve) => window.setTimeout(resolve, 850));
      statusRequestRef.current += 1;
      setOnBreak(false);
      setBreakStartedAt(null);
      notifyAttendanceUpdated();
    } catch (cause) {
      setReadyToReturn(false);
      setError(cause instanceof Error ? cause.message : 'Unable to resume work. Please try again.');
    } finally {
      setResuming(false);
    }
  };

  if (!onBreak || typeof document === 'undefined') return null;

  const breakStartedAtMs = breakStartedAt ? Date.parse(breakStartedAt) : Number.NaN;
  const elapsedSeconds = Number.isFinite(breakStartedAtMs)
    ? Math.max(0, Math.floor((nowMs - breakStartedAtMs) / 1000))
    : 0;
  const totalBreakSeconds = completedBreakSeconds + elapsedSeconds;
  const effectiveLimitMinutes = breakLimitMinutes ?? 60;
  const mood: BreakMood = readyToReturn
    ? 'ready'
    : totalBreakSeconds > effectiveLimitMinutes * 60
      ? 'rushed'
      : totalBreakSeconds < 8
        ? 'tired'
        : 'recovering';

  return createPortal(
    <dialog
      ref={dialogRef}
      className="break-mode-dialog"
      aria-labelledby="break-mode-title"
      onCancel={(event) => event.preventDefault()}
    >
      <div className="break-mode-content">
        <div className="break-mode-status" aria-label="Break in progress">
          <div className="break-mode-status-icon" aria-hidden="true">
            <svg viewBox="0 0 48 48" fill="none">
              <path d="M12 20h22v13a8 8 0 0 1-8 8h-6a8 8 0 0 1-8-8V20Z" />
              <path d="M34 23h3a5 5 0 0 1 0 10h-3M18 14v-4m7 4v-5m7 5v-4" />
            </svg>
          </div>
          <div className="break-mode-status-pill">
            <span className="break-mode-status-dot" />
            <span>Break in progress</span>
          </div>
        </div>
        <div className="break-mode-copy">
          <h2 id="break-mode-title" tabIndex={-1}>Enjoy your break</h2>
          <p className="break-mode-description">
            Your workspace is paused. Come back when you’re ready.
          </p>
        </div>
        <BreakCompanion mood={mood} />
        <div className="break-mode-timer-panel" data-over-limit={mood === 'rushed' ? 'true' : 'false'}>
          <BreakTimer totalBreakSeconds={totalBreakSeconds} limitMinutes={effectiveLimitMinutes} />
        </div>
        <div className="break-mode-footer">
          {error && <p className="break-mode-error" role="alert">{error}</p>}
          <button type="button" className="break-mode-resume ui-primary" onClick={() => void resume()} disabled={resuming}>
            {readyToReturn ? 'Back to it!' : resuming ? 'Returning…' : 'I’m ready to get back'}
            {!readyToReturn && !resuming && (
              <svg className="break-mode-resume-arrow" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M4 12h15m-6-6 6 6-6 6" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </dialog>,
    document.body,
  );
}
