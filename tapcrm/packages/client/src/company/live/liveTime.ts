import { useEffect, useState } from 'react';
import type { LiveRow } from './liveApi.js';

type LiveMinutesRow = Pick<LiveRow, 'state' | 'since' | 'workedMinutes' | 'breakMinutes' | 'minutesAsOf'>;

function minutesSince(iso: string | null | undefined, nowMs: number): number {
  if (!iso) return 0;
  const startMs = new Date(iso).getTime();
  if (Number.isNaN(startMs)) return 0;
  return Math.max(0, Math.floor((nowMs - startMs) / 60_000));
}

/**
 * Minutes worked and on break as of `nowMs`.
 *
 * The server works out `workedMinutes` and `breakMinutes` at one moment,
 * `minutesAsOf`, and again only when something happens (a punch, a break,
 * the end of the shift). In between, the open stretch keeps growing: while
 * working, the time since then is work; while on a break, it is break. A row
 * from before `minutesAsOf` existed falls back to `since`, the start of the
 * current stretch, which is when such rows were worked out.
 */
export function liveMinutes(row: LiveMinutesRow, nowMs: number): { worked: number; onBreak: number } {
  const running = minutesSince(row.minutesAsOf ?? row.since, nowMs);
  if (row.state === 'WORKING') return { worked: row.workedMinutes + running, onBreak: row.breakMinutes };
  if (row.state === 'ON_BREAK') return { worked: row.workedMinutes, onBreak: row.breakMinutes + running };
  return { worked: row.workedMinutes, onBreak: row.breakMinutes };
}

/** The current time, refreshed every `intervalMs`, for timers that count up on screen. */
export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}
