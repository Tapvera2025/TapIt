import type { DateOnly, LocalTime } from '@tapcrm/contracts';
import { addDays, daysBetween } from '../../platform/time.js';
import { SHIFT_ERROR_CODES, ShiftValidationError } from './errors.js';
import type { ShiftInputs } from './resolve.js';
import { dayShape } from './windows.js';

/** Design §6.3 — rules checked before anything is saved. */

const minutesOf = (time: LocalTime): number => {
  const [hours, minutes] = time.split(':').map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
};

/** 20:00 → 05:00 is 540: overnight is strictly end < start (§6.6). */
export function scheduledMinutes(start: LocalTime, end: LocalTime): number {
  return (minutesOf(end) - minutesOf(start) + 1_440) % 1_440;
}

export interface VersionFields {
  readonly kind: 'fixed' | 'flexible';
  readonly startTime: LocalTime | null;
  readonly endTime: LocalTime | null;
  readonly fullDayMinutes: number;
  readonly halfDayMinutes: number;
  readonly complementaryHalfMinutes: number | null;
}

export function validateVersion(fields: VersionFields): void {
  const { kind, startTime, endTime } = fields;
  if (kind === 'flexible') {
    if (startTime !== null || endTime !== null) {
      throw new ShiftValidationError(
        SHIFT_ERROR_CODES.TIMES_NOT_ALLOWED,
        'A flexible shift has no start or end time.',
      );
    }
    return;
  }
  if (startTime === null || endTime === null) {
    throw new ShiftValidationError(
      SHIFT_ERROR_CODES.TIMES_REQUIRED,
      'A fixed shift needs a start and an end time.',
    );
  }
  if (startTime === endTime) {
    throw new ShiftValidationError(
      SHIFT_ERROR_CODES.START_END_MUST_DIFFER,
      'Start and end are the same time. A shift cannot last 24 hours by accident; check the times.',
    );
  }
  const scheduled = scheduledMinutes(startTime, endTime);
  if (fields.halfDayMinutes <= 0 || fields.halfDayMinutes >= fields.fullDayMinutes) {
    throw new ShiftValidationError(
      SHIFT_ERROR_CODES.THRESHOLD_UNREACHABLE,
      'Half-day minutes must be more than 0 and less than full-day minutes.',
    );
  }
  if (fields.fullDayMinutes > scheduled) {
    throw new ShiftValidationError(
      SHIFT_ERROR_CODES.THRESHOLD_UNREACHABLE,
      `Full-day minutes (${fields.fullDayMinutes}) are more than the shift lasts (${scheduled}), so nobody could reach them.`,
      { scheduledMinutes: scheduled },
    );
  }
  if (
    fields.complementaryHalfMinutes !== null &&
    fields.complementaryHalfMinutes > scheduled / 2
  ) {
    throw new ShiftValidationError(
      SHIFT_ERROR_CODES.THRESHOLD_UNREACHABLE,
      `Complementary half minutes (${fields.complementaryHalfMinutes}) are more than half the shift (${scheduled / 2}).`,
      { scheduledMinutes: scheduled },
    );
  }
}

export interface WindowOverlap {
  readonly date: DateOnly;
  readonly previousShiftId: string | null;
  readonly shiftId: string | null;
  readonly overlapMinutes: number;
}

/** The furthest ahead an open-ended change is checked; later overlaps are caught at read time. */
export const OVERLAP_HORIZON_DAYS = 400;

/**
 * §6.3 "No overlap" — consecutive days whose own fixed shifts overlap, for
 * every date from the day before `from` to the day after `to`.
 */
export function findWindowOverlaps(
  inputs: ShiftInputs,
  from: DateOnly,
  to: DateOnly | null,
): WindowOverlap[] {
  const last =
    to === null || daysBetween(from, to) > OVERLAP_HORIZON_DAYS
      ? addDays(from, OVERLAP_HORIZON_DAYS)
      : to;
  const overlaps: WindowOverlap[] = [];
  let previous = dayShape(inputs, addDays(from, -1));
  for (let date = from; date <= addDays(last, 1); date = addDays(date, 1)) {
    const day = dayShape(inputs, date);
    if (
      previous.anchor === 'own-shift' &&
      day.anchor === 'own-shift' &&
      previous.end > day.start
    ) {
      overlaps.push({
        date,
        previousShiftId: previous.shiftId,
        shiftId: day.shiftId,
        overlapMinutes: Math.round(
          (previous.end.getTime() - day.start.getTime()) / 60_000,
        ),
      });
    }
    previous = day;
  }
  return overlaps;
}
