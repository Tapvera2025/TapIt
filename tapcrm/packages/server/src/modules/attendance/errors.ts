import { ApplicationError } from '../../errors.js';

export const ATTENDANCE_ERROR_CODES = {
  CLIENT_EVENT_REUSED:       'ATTENDANCE_CLIENT_EVENT_REUSED',
  NO_DAY_FOR_INSTANT:        'ATTENDANCE_NO_DAY_FOR_INSTANT',
  EVENT_NOT_FOUND:           'ATTENDANCE_EVENT_NOT_FOUND',
  DAY_NOT_FOUND:             'ATTENDANCE_DAY_NOT_FOUND',
  RANGE_TOO_LONG:            'ATTENDANCE_RANGE_TOO_LONG',
  EXPORT_RANGE_TOO_LONG:     'ATTENDANCE_EXPORT_RANGE_TOO_LONG',
  EXPORT_EMPTY_SCOPE:        'ATTENDANCE_EXPORT_EMPTY_SCOPE',
  EXPORT_SUPER_ADMIN_ONLY:   'ATTENDANCE_EXPORT_SUPER_ADMIN_ONLY',
  EXPORT_NOT_FOUND:          'ATTENDANCE_EXPORT_NOT_FOUND',
  // corrections
  CORRECTION_NOT_FOUND:         'ATTENDANCE_CORRECTION_NOT_FOUND',
  CORRECTION_TARGET_SUPERSEDED: 'ATTENDANCE_CORRECTION_TARGET_SUPERSEDED',
  CORRECTION_NOT_READABLE:      'ATTENDANCE_CORRECTION_NOT_READABLE',
  INVALID_CORRECTION_STATUS:    'ATTENDANCE_INVALID_CORRECTION_STATUS',
  CORRECTION_TOO_OLD:           'ATTENDANCE_CORRECTION_TOO_OLD',
  CORRECTION_OUT_OF_SCOPE:      'ATTENDANCE_CORRECTION_OUT_OF_SCOPE',
} as const;

/** 409: one client event id, two different requests (TX-7). */
export class AttendanceConflictError extends ApplicationError {
  constructor(code: string, message: string) {
    super(message, 409, code);
    this.name = 'AttendanceConflictError';
  }
}

export class AttendanceNotFoundError extends ApplicationError {
  constructor(code: string, message: string) {
    super(message, 404, code);
    this.name = 'AttendanceNotFoundError';
  }
}

export class AttendanceForbiddenError extends ApplicationError {
  constructor(code: string, message: string) {
    super(message, 403, code);
    this.name = 'AttendanceForbiddenError';
  }
}

export class AttendanceUnprocessableError extends ApplicationError {
  constructor(code: string, message: string) {
    super(message, 422, code);
    this.name = 'AttendanceUnprocessableError';
  }
}
