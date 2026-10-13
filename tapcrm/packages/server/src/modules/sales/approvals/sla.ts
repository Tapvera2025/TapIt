/**
 * Sales v1.1 R2 — Approval SLA (R2 plan step 2.11, R-APP-05).
 *
 * 4 business hours from `requested_at`. For step 2.11 we approximate
 * "business hours" as a weekday 10:00–19:00 window in the organization's
 * operational timezone (TECH L7). A richer implementation can plug into
 * the shifts/holidays modules later; the shape stays the same.
 *
 * T-4: all time arithmetic goes through platform/time.ts (the only
 * module that imports luxon).
 */

import { addBusinessMinutesSimple, toLocalTime } from '../../../platform/time.js';

const BUSINESS_HOURS_WINDOW_START = 10;         // 10:00
const BUSINESS_HOURS_WINDOW_END = 19;           // 19:00
const BUSINESS_HOURS_PER_DAY = BUSINESS_HOURS_WINDOW_END - BUSINESS_HOURS_WINDOW_START;
const SLA_HOURS = 4;

export const APPROVAL_SLA_HOURS = SLA_HOURS;

const BUSINESS_WINDOW = {
  dayStart: toLocalTime('10:00'),
  dayEnd: toLocalTime('19:00'),
  // Mon(1)..Fri(5) in Sun(0)..Sat(6) convention expected by platform/time.
  workingDays: [1, 2, 3, 4, 5],
};

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
  return addBusinessMinutesSimple(from, hours * 60, tz, BUSINESS_WINDOW);
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
