import { ApplicationError } from '../../errors.js';

export const HOLIDAY_ERROR_CODES = {
  DATE_REQUIRED: 'HOLIDAY_DATE_REQUIRED',
  DATE_NOT_ALLOWED: 'HOLIDAY_DATE_NOT_ALLOWED',
  RECURRENCE_REQUIRED: 'HOLIDAY_RECURRENCE_REQUIRED',
  RECURRENCE_NOT_ALLOWED: 'HOLIDAY_RECURRENCE_NOT_ALLOWED',
  RECURRENCE_INVALID: 'HOLIDAY_RECURRENCE_INVALID',
  EFFECTIVE_FROM_REQUIRED: 'HOLIDAY_EFFECTIVE_FROM_REQUIRED',
  RANGE_INVALID: 'HOLIDAY_RANGE_INVALID',
  SCOPE_INVALID: 'HOLIDAY_SCOPE_INVALID',
  SCOPE_INVALID_FOR_TYPE: 'HOLIDAY_SCOPE_INVALID_FOR_TYPE',
  SCOPE_REQUIRED: 'HOLIDAY_SCOPE_REQUIRED',
  SCOPE_MIXED_TARGETS: 'HOLIDAY_SCOPE_MIXED_TARGETS',
  SCOPE_TARGET_NOT_FOUND: 'HOLIDAY_SCOPE_TARGET_NOT_FOUND',
  NOT_FOUND: 'HOLIDAY_NOT_FOUND',
  WITHDRAWN: 'HOLIDAY_WITHDRAWN',
  PAST_CHANGE_NEEDS_CORRECTION_AUTHORITY:
    'HOLIDAY_PAST_CHANGE_NEEDS_CORRECTION_AUTHORITY',
} as const;

export class HolidayValidationError extends ApplicationError {
  constructor(code: string, message: string, details?: unknown) {
    super(message, 422, code, details);
    this.name = 'HolidayValidationError';
  }
}
export class HolidayForbiddenError extends ApplicationError {
  constructor(code: string, message: string) {
    super(message, 403, code);
    this.name = 'HolidayForbiddenError';
  }
}
export class HolidayNotFoundError extends ApplicationError {
  constructor(message: string) {
    super(message, 404, HOLIDAY_ERROR_CODES.NOT_FOUND);
    this.name = 'HolidayNotFoundError';
  }
}
export class HolidayConflictError extends ApplicationError {
  constructor(code: string, message: string, details?: unknown) {
    super(message, 409, code, details);
    this.name = 'HolidayConflictError';
  }
}
