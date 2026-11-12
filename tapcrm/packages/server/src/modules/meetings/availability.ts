import type { DateOnly, ResolvedDay, ResolvedShift } from '@tapcrm/contracts';
import type { RequestContext } from '../../platform/dal/context.js';
import { db, type Tx } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import { addDays, instantAt, localDateOf, toLocalTime, utcOffsetMinutes } from '../../platform/time.js';
import { dayTypeRange } from '../holidays/facade.js';
import { resolveRange } from '../shifts/facade.js';
import { calendarAccess, markNeedsReconnect, type CalendarAccess } from './google/access.js';
import { CalendarAuthError, freeBusy } from './google/calendar.js';
import type { AvailabilityResult, MeetingSlot } from './types.js';

/**
 * When people are free to meet.
 *
 *   working time   their shift on each working day (holidays and week-offs
 *                  are off); a flexible shift, or none, counts as 10:00–18:00
 *   minus          approved leave (a half day takes half the day), their open
 *                  meetings and offered times, their pending callbacks, and
 *                  busy times on their Google Calendar when TapCRM can read it
 *
 * Slots start on the hour or half hour in the organization's time zone.
 */

export interface Interval {
  readonly start: number;
  readonly end: number;
}

const MINUTE = 60_000;
const DEFAULT_DAY_START = toLocalTime('10:00');
const DEFAULT_DAY_END = toLocalTime('18:00');
/** A callback blocks this long. */
const CALLBACK_MINUTES = 15;

/* ------------------------------------------------------------------ *
 * Interval arithmetic (pure)
 * ------------------------------------------------------------------ */

export function mergeIntervals(list: readonly Interval[]): Interval[] {
  const sorted = list.filter((item) => item.end > item.start).sort((a, b) => a.start - b.start);
  const merged: Interval[] = [];
  for (const item of sorted) {
    const last = merged[merged.length - 1];
    if (last && item.start <= last.end) merged[merged.length - 1] = { start: last.start, end: Math.max(last.end, item.end) };
    else merged.push({ ...item });
  }
  return merged;
}

export function subtractIntervals(free: readonly Interval[], busy: readonly Interval[]): Interval[] {
  const blocks = mergeIntervals(busy);
  const out: Interval[] = [];
  for (const window of mergeIntervals(free)) {
    let cursor = window.start;
    for (const block of blocks) {
      if (block.end <= cursor || block.start >= window.end) continue;
      if (block.start > cursor) out.push({ start: cursor, end: Math.min(block.start, window.end) });
      cursor = Math.max(cursor, block.end);
      if (cursor >= window.end) break;
    }
    if (cursor < window.end) out.push({ start: cursor, end: window.end });
  }
  return out;
}

export function intersectIntervals(left: readonly Interval[], right: readonly Interval[]): Interval[] {
  const a = mergeIntervals(left);
  const b = mergeIntervals(right);
  const out: Interval[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const start = Math.max(a[i]!.start, b[j]!.start);
    const end = Math.min(a[i]!.end, b[j]!.end);
    if (end > start) out.push({ start, end });
    if (a[i]!.end < b[j]!.end) i += 1;
    else j += 1;
  }
  return out;
}

/** The next instant at or after `at` that falls on a step boundary of the zone's clock. */
export function alignUp(at: number, stepMinutes: number, zone: string): number {
  const offset = utcOffsetMinutes(zone, new Date(at)) * MINUTE;
  const step = stepMinutes * MINUTE;
  return Math.ceil((at + offset) / step) * step - offset;
}

/** Start times of every `durationMinutes` meeting that fits in `free`. */
export function slotStarts(
  free: readonly Interval[],
  durationMinutes: number,
  stepMinutes: number,
  zone: string,
  earliest: number,
  latest: number,
): number[] {
  const starts: number[] = [];
  const duration = durationMinutes * MINUTE;
  for (const window of mergeIntervals(free)) {
    for (let at = alignUp(Math.max(window.start, earliest), stepMinutes, zone); at + duration <= window.end && at <= latest; at += stepMinutes * MINUTE) {
      starts.push(at);
    }
  }
  return starts;
}

export type LeaveHalf = 'full' | 'first' | 'second';

export interface LeaveSpan {
  readonly fromDate: DateOnly;
  readonly toDate: DateOnly;
  readonly fromHalf: LeaveHalf;
  readonly toHalf: LeaveHalf;
}

/** Which part of `date` an approved leave takes, if any. */
export function leaveOn(date: DateOnly, leave: LeaveSpan): LeaveHalf | null {
  if (date < leave.fromDate || date > leave.toDate) return null;
  if (leave.fromDate === leave.toDate) {
    if (leave.fromHalf === 'full' || leave.toHalf === 'full') return 'full';
    return leave.fromHalf === leave.toHalf ? leave.fromHalf : 'full';
  }
  if (date === leave.fromDate && leave.fromHalf === 'second') return 'second';
  if (date === leave.toDate && leave.toHalf === 'first') return 'first';
  return 'full';
}

/** The day's working window, or none on a day off. */
export function workingWindow(
  day: ResolvedDay,
  shift: ResolvedShift,
  leaves: readonly LeaveSpan[],
  organizationZone: string,
): Interval | null {
  if (day.type !== 'working') return null;
  const parts = leaves.map((leave) => leaveOn(day.date, leave)).filter((part): part is LeaveHalf => part !== null);
  if (parts.includes('full') || (parts.includes('first') && parts.includes('second'))) return null;
  let start: number;
  let end: number;
  if (shift.kind === 'fixed' && shift.start && shift.end) {
    start = instantAt(day.date, shift.start, shift.timezone).getTime();
    end = instantAt(shift.isOvernight ? addDays(day.date, 1) : day.date, shift.end, shift.timezone).getTime();
  } else {
    start = instantAt(day.date, DEFAULT_DAY_START, organizationZone).getTime();
    end = instantAt(day.date, DEFAULT_DAY_END, organizationZone).getTime();
  }
  if (end <= start) return null;
  const middle = start + Math.floor((end - start) / 2 / MINUTE) * MINUTE;
  if (parts.includes('first')) start = middle;
  if (parts.includes('second')) end = middle;
  return { start, end };
}

/* ------------------------------------------------------------------ *
 * Loading one person's time
 * ------------------------------------------------------------------ */

export async function organizationTimezone(tx: Tx, organizationId: string): Promise<string> {
  const row = await tx.maybeOne<{ timezone: string | null }>(sql`SELECT timezone FROM organization WHERE id = ${organizationId}`);
  return row?.timezone ?? 'Asia/Kolkata';
}

/** Working time minus everything TapCRM knows about; Google is added separately. */
export async function tapcrmFreeTime(
  tx: Tx,
  organizationId: string,
  userId: string,
  from: Date,
  to: Date,
  zone: string,
  excludeMeetingId: string | null,
): Promise<Interval[]> {
  const fromDate = addDays(localDateOf(from, zone), -1);
  const toDate = localDateOf(to, zone);
  const [shifts, days, leaves, busy] = await Promise.all([
    resolveRange(tx, userId, fromDate, toDate),
    dayTypeRange(tx, userId, fromDate, toDate),
    tx.query<LeaveSpan>(sql`
      SELECT from_date::text AS "fromDate", to_date::text AS "toDate", from_half AS "fromHalf", to_half AS "toHalf"
        FROM leave_request
       WHERE organization_id = ${organizationId} AND user_id = ${userId}
         AND kind = 'absence' AND status = 'approved'
         AND from_date <= ${toDate}::date AND to_date >= ${fromDate}::date
    `),
    tx.query<{ startsAt: Date; endsAt: Date }>(sql`
      SELECT m.starts_at AS "startsAt", m.ends_at AS "endsAt"
        FROM meeting m
       WHERE m.organization_id = ${organizationId}
         AND (m.status IN ('requested', 'confirmed') OR (m.status = 'proposed' AND m.calendar_event_id IS NOT NULL))
         AND m.starts_at < ${to} AND m.ends_at > ${from}
         AND (${excludeMeetingId}::uuid IS NULL OR m.id <> ${excludeMeetingId}::uuid)
         AND (m.host_id = ${userId} OR EXISTS (
               SELECT 1 FROM meeting_attendee a
                WHERE a.organization_id = m.organization_id AND a.meeting_id = m.id
                  AND a.user_id = ${userId} AND a.role IN ('host', 'staff')))
      UNION ALL
      SELECT p.starts_at, p.ends_at
        FROM meeting_proposal p
        JOIN meeting m ON m.organization_id = p.organization_id AND m.id = p.meeting_id
       WHERE p.organization_id = ${organizationId} AND m.status = 'proposed'
         AND p.chosen_at IS NULL AND p.withdrawn_at IS NULL
         AND p.starts_at < ${to} AND p.ends_at > ${from}
         AND (${excludeMeetingId}::uuid IS NULL OR m.id <> ${excludeMeetingId}::uuid)
         AND m.host_id = ${userId}
      UNION ALL
      SELECT c.scheduled_at, c.scheduled_at + make_interval(mins => ${CALLBACK_MINUTES})
        FROM lead_callback c
       WHERE c.organization_id = ${organizationId} AND c.owner_id = ${userId} AND c.status = 'pending'
         AND c.scheduled_at < ${to} AND c.scheduled_at + make_interval(mins => ${CALLBACK_MINUTES}) > ${from}
    `),
  ]);
  const byDate = new Map(shifts.map((shift) => [shift.date, shift]));
  const windows: Interval[] = [];
  for (const day of days) {
    const shift = byDate.get(day.date);
    if (!shift) continue;
    const window = workingWindow(day, shift, leaves, zone);
    if (window) windows.push(window);
  }
  const range = { start: from.getTime(), end: to.getTime() };
  return subtractIntervals(
    intersectIntervals(windows, [range]),
    busy.map((item) => ({ start: new Date(item.startsAt).getTime(), end: new Date(item.endsAt).getTime() })),
  );
}

/** Busy times on the person's Google Calendar, or why they could not be read. */
export async function googleBusy(
  ctx: RequestContext,
  userId: string,
  from: Date,
  to: Date,
): Promise<{ busy: Interval[]; unchecked: string | null }> {
  const access: CalendarAccess = await calendarAccess(ctx, userId);
  if (access.token === null) {
    if (access.reason === 'off') return { busy: [], unchecked: null };
    return {
      busy: [],
      unchecked: access.reason === 'not_connected'
        ? 'Google Calendar not connected'
        : access.reason === 'needs_reconnect'
          ? 'Google Calendar needs reconnecting'
          : 'Google Calendar could not be read',
    };
  }
  try {
    const busy = await freeBusy(access.token, from, to);
    return { busy: busy.map((item) => ({ start: item.start.getTime(), end: item.end.getTime() })), unchecked: null };
  } catch (cause) {
    if (cause instanceof CalendarAuthError) await markNeedsReconnect(ctx, userId, cause.message);
    return { busy: [], unchecked: 'Google Calendar could not be read' };
  }
}

export interface AvailabilityQuery {
  /** Everyone who has to be free (all of them), or candidates (any one of them). */
  readonly userIds: readonly string[];
  readonly mode: 'all' | 'any';
  readonly durationMinutes: number;
  readonly from: Date;
  readonly to: Date;
  readonly excludeMeetingId?: string | null;
  readonly stepMinutes?: number;
  readonly limit?: number;
}

/** Free slots for a group (`all`) or for whichever candidate is free (`any`). */
export async function findSlots(ctx: RequestContext, query: AvailabilityQuery): Promise<AvailabilityResult> {
  const people = await db.query<{ id: string; name: string }>(ctx, sql`
    SELECT id, full_name AS name FROM app_user
     WHERE organization_id = ${ctx.organizationId} AND id = ANY(${[...query.userIds]}::uuid[]) AND status = 'active'
  `);
  const { zone, local } = await db.transaction(ctx, async (tx) => {
    const zoneName = await organizationTimezone(tx, ctx.organizationId);
    const perPerson = new Map<string, Interval[]>();
    for (const person of people) {
      perPerson.set(person.id, await tapcrmFreeTime(tx, ctx.organizationId, person.id, query.from, query.to, zoneName, query.excludeMeetingId ?? null));
    }
    return { zone: zoneName, local: perPerson };
  });
  const calendarUnchecked: Array<{ id: string; name: string; reason: string }> = [];
  const free = new Map<string, Interval[]>();
  await Promise.all(people.map(async (person) => {
    const google = await googleBusy(ctx, person.id, query.from, query.to);
    if (google.unchecked) calendarUnchecked.push({ id: person.id, name: person.name, reason: google.unchecked });
    free.set(person.id, subtractIntervals(local.get(person.id) ?? [], google.busy));
  }));

  const step = query.stepMinutes ?? 30;
  const earliest = query.from.getTime();
  const latest = query.to.getTime();
  const limit = query.limit ?? 400;
  const slots: MeetingSlot[] = [];
  if (query.mode === 'all') {
    if (people.length !== query.userIds.length) return { slots: [], calendarUnchecked, timezone: zone };
    const shared = people.reduce<Interval[] | null>((acc, person) => {
      const mine = free.get(person.id) ?? [];
      return acc === null ? mine : intersectIntervals(acc, mine);
    }, null) ?? [];
    for (const start of slotStarts(shared, query.durationMinutes, step, zone, earliest, latest).slice(0, limit)) {
      slots.push({ startsAt: new Date(start), endsAt: new Date(start + query.durationMinutes * MINUTE), hostIds: people.map((person) => person.id) });
    }
  } else {
    const byStart = new Map<number, string[]>();
    for (const person of people) {
      for (const start of slotStarts(free.get(person.id) ?? [], query.durationMinutes, step, zone, earliest, latest)) {
        byStart.set(start, [...(byStart.get(start) ?? []), person.id]);
      }
    }
    for (const start of [...byStart.keys()].sort((a, b) => a - b).slice(0, limit)) {
      slots.push({ startsAt: new Date(start), endsAt: new Date(start + query.durationMinutes * MINUTE), hostIds: byStart.get(start)! });
    }
  }
  return { slots, calendarUnchecked, timezone: zone };
}
