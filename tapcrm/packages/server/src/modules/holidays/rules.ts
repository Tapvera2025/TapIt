import type { DateOnly, HolidaySubtype } from '@tapcrm/contracts';
import { HOLIDAY_ERROR_CODES, HolidayValidationError } from './errors.js';
import type { WeekOffRecurrence } from './resolve.js';

export interface HolidayFields {
  readonly type: HolidaySubtype;
  readonly holidayDate: DateOnly | null;
  readonly recurrence: WeekOffRecurrence | null;
  readonly effectiveFrom: DateOnly | null;
  readonly effectiveTo: DateOnly | null;
}

function validateRecurrence(recurrence: WeekOffRecurrence): void {
  const okDays =
    recurrence.weekdays.length > 0 &&
    recurrence.weekdays.every((n) => Number.isInteger(n) && n >= 1 && n <= 7);
  const okWeeks =
    recurrence.weeksOfMonth === undefined ||
    (recurrence.weeksOfMonth.length > 0 &&
      recurrence.weeksOfMonth.every((n) => Number.isInteger(n) && n >= 1 && n <= 5));
  if (!okDays || !okWeeks) {
    throw new HolidayValidationError(
      HOLIDAY_ERROR_CODES.RECURRENCE_INVALID,
      'Weekdays must be 1..7 (Mon..Sun); weeksOfMonth, if given, must be 1..5.',
    );
  }
}

export function validateHoliday(fields: HolidayFields): void {
  if (fields.type === 'week-off') {
    if (fields.holidayDate !== null) {
      throw new HolidayValidationError(
        HOLIDAY_ERROR_CODES.DATE_NOT_ALLOWED,
        'A week-off rule has no single holidayDate.',
      );
    }
    if (fields.recurrence === null) {
      throw new HolidayValidationError(
        HOLIDAY_ERROR_CODES.RECURRENCE_REQUIRED,
        'A week-off rule needs a recurrence (weekdays, optional weeksOfMonth).',
      );
    }
    if (fields.effectiveFrom === null) {
      throw new HolidayValidationError(
        HOLIDAY_ERROR_CODES.EFFECTIVE_FROM_REQUIRED,
        'A week-off rule needs effectiveFrom.',
      );
    }
    validateRecurrence(fields.recurrence);
  } else {
    if (fields.holidayDate === null) {
      throw new HolidayValidationError(
        HOLIDAY_ERROR_CODES.DATE_REQUIRED,
        'A dated holiday needs holidayDate.',
      );
    }
    if (fields.recurrence !== null) {
      throw new HolidayValidationError(
        HOLIDAY_ERROR_CODES.RECURRENCE_NOT_ALLOWED,
        'A dated holiday cannot carry a recurrence (that is a week-off).',
      );
    }
  }
  if (
    fields.effectiveTo !== null &&
    fields.effectiveFrom !== null &&
    fields.effectiveTo <= fields.effectiveFrom
  ) {
    throw new HolidayValidationError(
      HOLIDAY_ERROR_CODES.RANGE_INVALID,
      'effectiveTo must be after effectiveFrom.',
    );
  }
}

export interface ScopeFields {
  readonly departmentId: string | null;
  readonly shiftId: string | null;
}

export function validateScope(fields: ScopeFields): void {
  const set = Number(fields.departmentId !== null) + Number(fields.shiftId !== null);
  if (set !== 1) {
    throw new HolidayValidationError(
      HOLIDAY_ERROR_CODES.SCOPE_INVALID,
      'A scope row targets exactly one of department or shift.',
    );
  }
}

/**
 * The service layer's invariant: `holiday.type` decides which scope shapes are
 * legal. See the decisions table at the top of the plan.
 *
 *   national → no rows
 *   regional → 1..N rows, all department OR all shift
 *   optional → 0 rows, or 1..N rows all department (no shift)
 *   week-off → 0 rows, or 1..N rows all department, or 1..N rows all shift
 */
export function validateScopeSet(
  type: HolidaySubtype,
  rows: readonly ScopeFields[],
): void {
  for (const row of rows) validateScope(row);
  const hasDept = rows.some((r) => r.departmentId !== null);
  const hasShift = rows.some((r) => r.shiftId !== null);

  if (type === 'national') {
    if (rows.length > 0) {
      throw new HolidayValidationError(
        HOLIDAY_ERROR_CODES.SCOPE_INVALID_FOR_TYPE,
        'A national holiday cannot carry scope rows.',
      );
    }
    return;
  }
  if (type === 'regional') {
    if (rows.length === 0) {
      throw new HolidayValidationError(
        HOLIDAY_ERROR_CODES.SCOPE_REQUIRED,
        'A regional holiday needs at least one department or shift scope.',
      );
    }
  }
  if (type === 'optional' && hasShift) {
    throw new HolidayValidationError(
      HOLIDAY_ERROR_CODES.SCOPE_INVALID_FOR_TYPE,
      'An optional holiday cannot be scoped to a shift; use department scope or leave it national.',
    );
  }
  if (hasDept && hasShift) {
    throw new HolidayValidationError(
      HOLIDAY_ERROR_CODES.SCOPE_MIXED_TARGETS,
      'A holiday cannot mix department and shift scopes; choose one axis.',
    );
  }
}
