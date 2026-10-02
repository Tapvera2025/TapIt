import { ApplicationError } from '../../errors.js';

export const SHIFT_ERROR_CODES = {
  START_END_MUST_DIFFER: 'SHIFT_START_END_MUST_DIFFER',
  TIMES_REQUIRED: 'SHIFT_TIMES_REQUIRED',
  TIMES_NOT_ALLOWED: 'SHIFT_TIMES_NOT_ALLOWED',
  THRESHOLD_UNREACHABLE: 'SHIFT_THRESHOLD_UNREACHABLE',
  WINDOW_OVERLAP: 'SHIFT_WINDOW_OVERLAP',
  INACTIVE: 'SHIFT_INACTIVE',
  NO_VERSION: 'SHIFT_NO_VERSION',
  VERSION_EXISTS: 'SHIFT_VERSION_EXISTS',
  CODE_TAKEN: 'SHIFT_CODE_TAKEN',
  ASSIGNMENT_CONFLICT: 'SHIFT_ASSIGNMENT_CONFLICT',
  REQUEST_NOT_PENDING: 'SHIFT_REQUEST_NOT_PENDING',
  PAST_CHANGE_NEEDS_CORRECTION_AUTHORITY: 'SHIFT_PAST_CHANGE_NEEDS_CORRECTION_AUTHORITY',
  NOT_FOUND: 'SHIFT_NOT_FOUND',
  RANGE_TOO_LONG: 'SHIFT_RANGE_TOO_LONG',
  OVERRIDE_NEEDS_SHIFT: 'SHIFT_OVERRIDE_NEEDS_SHIFT',
} as const;

/** 422: the principal may make this kind of change, but not this one. */
export class ShiftValidationError extends ApplicationError {
  constructor(code: string, message: string, details?: unknown) {
    super(message, 422, code, details);
    this.name = 'ShiftValidationError';
  }
}

/** SH-6: a past-dated change also needs `attendance:correct`. */
export class ShiftForbiddenError extends ApplicationError {
  constructor(code: string, message: string) {
    super(message, 403, code);
    this.name = 'ShiftForbiddenError';
  }
}

export class ShiftNotFoundError extends ApplicationError {
  constructor(message: string) {
    super(message, 404, SHIFT_ERROR_CODES.NOT_FOUND);
    this.name = 'ShiftNotFoundError';
  }
}

export class ShiftConflictError extends ApplicationError {
  constructor(code: string, message: string, details?: unknown) {
    super(message, 409, code, details);
    this.name = 'ShiftConflictError';
  }
}
