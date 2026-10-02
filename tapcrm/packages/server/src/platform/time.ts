import { DateTime, IANAZone } from 'luxon';
import type { DateOnly, LocalTime } from '@tapcrm/contracts';

/**
 * Dates and times — attendance design §5.1.
 *
 *   T-1  Instants are UTC; a day is a date in the organization's timezone.
 *   T-3  A shift time becomes an instant with THAT date's zone rules, so a
 *        daylight-saving change cannot move a boundary.
 *   T-4  This is the only file that imports luxon (`npm run ci` enforces it),
 *        so moving to the built-in Temporal later is a one-file change.
 *   T-5  Services and jobs take a Clock; tests pass a fixed one.
 *   T-6  Event instants are whole seconds.
 */

/** T-5 — the one way to ask the time. Calculators never ask at all. */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

export function fixedClock(at: Date | string): Clock {
  const instant = new Date(at).getTime();
  if (Number.isNaN(instant)) throw new RangeError(`"${String(at)}" is not an instant`);
  return { now: () => new Date(instant) };
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const LOCAL_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export function toDateOnly(value: string): DateOnly {
  if (DATE_ONLY.test(value) && DateTime.fromISO(value, { zone: 'UTC' }).isValid) {
    return value as DateOnly;
  }
  throw new RangeError(`"${value}" is not a calendar date (YYYY-MM-DD)`);
}

export function toLocalTime(value: string): LocalTime {
  if (LOCAL_TIME.test(value)) return value as LocalTime;
  throw new RangeError(`"${value}" is not a time of day (HH:mm)`);
}

export function isTimeZone(zone: string): boolean {
  return IANAZone.isValidZone(zone);
}

function zoneOrThrow(zone: string): string {
  if (!IANAZone.isValidZone(zone)) throw new RangeError(`"${zone}" is not an IANA timezone`);
  return zone;
}

/** T-6 — drops the milliseconds. */
export function wholeSeconds(instant: Date): Date {
  return new Date(Math.floor(instant.getTime() / 1000) * 1000);
}

/** T-1 — the calendar date an instant falls on in `zone`. */
export function localDateOf(instant: Date, zone: string): DateOnly {
  const date = DateTime.fromJSDate(instant, { zone: zoneOrThrow(zone) }).toISODate();
  if (date === null) throw new RangeError(`${String(instant)} is not a valid instant`);
  return date as DateOnly;
}

/** T-3 — the instant a wall-clock time on `date` happens in `zone`. */
export function instantAt(date: DateOnly, time: LocalTime, zone: string): Date {
  const local = DateTime.fromISO(`${date}T${time}`, { zone: zoneOrThrow(zone) });
  if (!local.isValid) throw new RangeError(`${date} ${time} does not exist in ${zone}`);
  return local.toJSDate();
}

/**
 * A device's own clock reading: a calendar date and a time to the second, with
 * no zone, written 'YYYY-MM-DD HH:mm:ss' (§10.2). It is what the device said,
 * kept as said; only `instantOfDeviceClock` turns it into an instant.
 */
export type DeviceClockReading = string & { readonly __deviceClockReading: true };

const DEVICE_CLOCK = /^(\d{4})-(\d{2})-(\d{2})[ T]([01]\d|2[0-3]):([0-5]\d):([0-5]\d)$/;

/** Checks a device clock reading — a real date, whole seconds — and writes it one way. */
export function toDeviceClockReading(value: string): DeviceClockReading {
  const match = DEVICE_CLOCK.exec(value);
  if (match !== null) {
    const [, year, month, day, hour, minute, second] = match;
    if (DateTime.fromISO(`${year}-${month}-${day}`, { zone: 'UTC' }).isValid)
      return `${year}-${month}-${day} ${hour}:${minute}:${second}` as DeviceClockReading;
  }
  throw new RangeError(`"${value}" is not a device clock reading (YYYY-MM-DD HH:mm:ss)`);
}

export interface DeviceClockInstant {
  readonly instant: Date;
  /** The reading happens twice in `zone` (the hour the clocks go back); the first is taken. */
  readonly ambiguous: boolean;
}

/**
 * The instant a device clock reading names in `zone`, to the second (§10.3
 * step 3). A reading that happens twice, in the hour the clocks go back, is
 * taken the first time and says so. One that never happens, in the hour they
 * go forward, is refused: the device's clock or zone is wrong, and moving the
 * reading would invent a time.
 */
export function instantOfDeviceClock(
  reading: DeviceClockReading,
  zone: string,
): DeviceClockInstant {
  const local = DateTime.fromFormat(reading, 'yyyy-MM-dd HH:mm:ss', {
    zone: zoneOrThrow(zone),
  });
  if (!local.isValid || local.toFormat('yyyy-MM-dd HH:mm:ss') !== reading)
    throw new RangeError(`${reading} does not exist in ${zone}`);
  return { instant: local.toJSDate(), ambiguous: local.getPossibleOffsets().length > 1 };
}

/** The reading a clock set to `zone` shows at `instant` — what a device should say. */
export function deviceClockAt(instant: Date, zone: string): DeviceClockReading {
  return DateTime.fromJSDate(instant, { zone: zoneOrThrow(zone) }).toFormat(
    'yyyy-MM-dd HH:mm:ss',
  ) as DeviceClockReading;
}

/** Minutes `zone` is ahead of UTC at `instant` (330 for Asia/Kolkata). */
export function utcOffsetMinutes(zone: string, instant: Date): number {
  return DateTime.fromJSDate(instant, { zone: zoneOrThrow(zone) }).offset;
}

export function addDays(date: DateOnly, days: number): DateOnly {
  const next = DateTime.fromISO(date, { zone: 'UTC' }).plus({ days }).toISODate();
  if (next === null) throw new RangeError(`cannot add ${days} days to ${date}`);
  return next as DateOnly;
}

/** ISO weekday of a calendar date: 1 Monday … 7 Sunday. */
export function weekdayOf(date: DateOnly): number {
  return DateTime.fromISO(date, { zone: 'UTC' }).weekday;
}

/** Whole days from `from` to `to`; negative when `to` is earlier. */
export function daysBetween(from: DateOnly, to: DateOnly): number {
  return Math.round(
    DateTime.fromISO(to, { zone: 'UTC' }).diff(DateTime.fromISO(from, { zone: 'UTC' }), 'days').days,
  );
}
