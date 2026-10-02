import { ApplicationError } from '../../errors.js';

export const LEAVE_ERROR_CODES = {
  NOT_FOUND:            'LEAVE_NOT_FOUND',
  TYPE_NOT_FOUND:       'LEAVE_TYPE_NOT_FOUND',
  FORBIDDEN:            'LEAVE_FORBIDDEN',
  SELF_ACKNOWLEDGE:     'LEAVE_SELF_ACKNOWLEDGE',
  SELF_DECIDE:          'LEAVE_SELF_DECIDE',
  OVERLAP:              'LEAVE_OVERLAP',
  INSUFFICIENT_BALANCE: 'LEAVE_INSUFFICIENT_BALANCE',
  INVALID_DATES:        'LEAVE_INVALID_DATES',
  CROSS_YEAR:           'LEAVE_CROSS_YEAR',
  INVALID_STATUS:       'LEAVE_INVALID_STATUS',
  INVALID_KIND:             'LEAVE_INVALID_KIND',
  ENFORCEMENT_NOT_ENABLED:  'LEAVE_ENFORCEMENT_NOT_ENABLED',
} as const;

export class LeaveNotFoundError extends ApplicationError {
  constructor(message = 'Leave request not found') {
    super(message, 404, LEAVE_ERROR_CODES.NOT_FOUND);
    this.name = 'LeaveNotFoundError';
  }
}
export class LeaveTypeNotFoundError extends ApplicationError {
  constructor(message = 'Leave type not found') {
    super(message, 404, LEAVE_ERROR_CODES.TYPE_NOT_FOUND);
    this.name = 'LeaveTypeNotFoundError';
  }
}
export class LeaveForbiddenError extends ApplicationError {
  constructor(code: string, message: string) {
    super(message, 403, code);
    this.name = 'LeaveForbiddenError';
  }
}
export class LeaveValidationError extends ApplicationError {
  constructor(code: string, message: string, details?: unknown) {
    super(message, 422, code, details);
    this.name = 'LeaveValidationError';
  }
}
export class LeaveConflictError extends ApplicationError {
  constructor(code: string, message: string, details?: unknown) {
    super(message, 409, code, details);
    this.name = 'LeaveConflictError';
  }
}
