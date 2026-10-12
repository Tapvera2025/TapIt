/**
 * Sales v1.1 R2 — Approval SLA (R2 plan step 2.11, R-APP-05).
 *
 * 4 business hours from `requested_at`. For step 2.11 we approximate
 * "business hours" as a weekday 10:00–19:00 window in the organization's
 * operational timezone (TECH L7). A richer implementation can plug into
 * the shifts/holidays modules later; the shape stays the same.
 */

import { DateTime, type DateTimeMaybeValid } from 'luxon';

const BUSINESS_HOURS_WINDOW_START = 10;         // 10:00
const BUSINESS_HOURS_WINDOW_END = 19;           // 19:00
const BUSINESS_HOURS_PER_DAY = BUSINESS_HOURS_WINDOW_END - BUSINESS_HOURS_WINDOW_START;
const SLA_HOURS = 4;

export const APPROVAL_SLA_HOURS = SLA_HOURS;

function clampToBusinessStart(dt: DateTimeMaybeValid): DateTimeMaybeValid {
  if (dt.weekday === 6) {
    // Saturday — jump to Monday 10:00
    return dt.plus({ days: 2 }).set({ hour: BUSINESS_HOURS_WINDOW_START, minute: 0, second: 0, millisecond: 0 });
  }
  if (dt.weekday === 7) {
    return dt.plus({ days: 1 }).set({ hour: BUSINESS_HOURS_WINDOW_START, minute: 0, second: 0, millisecond: 0 });
  }
  if (dt.hour < BUSINESS_HOURS_WINDOW_START) {
    return dt.set({ hour: BUSINESS_HOURS_WINDOW_START, minute: 0, second: 0, millisecond: 0 });
  }
  if (dt.hour >= BUSINESS_HOURS_WINDOW_END) {
    const next = dt.plus({ days: 1 }).set({ hour: BUSINESS_HOURS_WINDOW_START, minute: 0, second: 0, millisecond: 0 });
    return clampToBusinessStart(next);
  }
  return dt;
}

export interface SlaOptions {
  readonly timezone?: string;              // defaults to Asia/Kolkata (TECH L7)
  readonly hours?: number;                 // defaults to 4
}

/**
 * Compute SLA due time by advancing business hours from `from`. "Business
 * hours" are Mon–Fri 10:00–19:00 in the specified timezone. If `from`
 * falls outside the window, we clamp to the next business start.
 */
export function computeSlaDueAt(from: Date, opts: SlaOptions = {}): Date {
  const tz = opts.timezone ?? 'Asia/Kolkata';
  const hours = opts.hours ?? SLA_HOURS;
  if (hours <= 0) return from;

  let dt: DateTimeMaybeValid = DateTime.fromJSDate(from).setZone(tz);
  dt = clampToBusinessStart(dt);

  let remaining = hours;
  while (remaining > 0) {
    const hoursLeftToday = BUSINESS_HOURS_WINDOW_END - (dt.hour + dt.minute / 60);
    if (hoursLeftToday >= remaining) {
      dt = dt.plus({ hours: remaining });
      remaining = 0;
    } else {
      remaining -= hoursLeftToday;
      dt = clampToBusinessStart(
        dt.plus({ hours: hoursLeftToday + 0.001 }),       // nudge past 19:00 so the clamp jumps to the next day
      );
    }
  }

  return dt.toUTC().toJSDate();
}

/** Days-of-business from `requestedAt` to `now`, snapped to minutes. */
export function minutesPastSla(now: Date, slaDueAt: Date): number {
  return Math.floor((now.getTime() - slaDueAt.getTime()) / 60_000);
}

export function isBreached(now: Date, slaDueAt: Date): boolean {
  return now.getTime() >= slaDueAt.getTime();
}

/** Full business-hour-day span for guardrails + tests. */
export const BUSINESS_HOURS = {
  start: BUSINESS_HOURS_WINDOW_START,
  end: BUSINESS_HOURS_WINDOW_END,
  perDay: BUSINESS_HOURS_PER_DAY,
};
