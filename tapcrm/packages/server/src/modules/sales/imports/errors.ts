import { ApplicationError } from '../../../errors.js';

export const IMPORT_ERROR_CODES = {
  NOT_FOUND: 'IMPORT_NOT_FOUND',
  FILE_UNREADABLE: 'IMPORT_FILE_UNREADABLE',
  TOO_MANY_ROWS: 'IMPORT_TOO_MANY_ROWS',
  VALIDATION: 'IMPORT_VALIDATION_ERROR',
  STATE: 'IMPORT_STATE_CONFLICT',
  ASSIGN_INVALID: 'IMPORT_ASSIGN_INVALID',
} as const;

export class ImportNotFoundError extends ApplicationError {
  constructor(what = 'Lead import') {
    super(`${what} not found`, 404, IMPORT_ERROR_CODES.NOT_FOUND);
    this.name = 'ImportNotFoundError';
  }
}

/** The upload could not be read as a table (wrong format, empty, damaged). */
export class ImportFileError extends ApplicationError {
  constructor(message: string) {
    super(message, 422, IMPORT_ERROR_CODES.FILE_UNREADABLE);
    this.name = 'ImportFileError';
  }
}

export class ImportTooManyRowsError extends ApplicationError {
  constructor(limit: number) {
    super(`This list has more than ${limit.toLocaleString('en-US')} rows. Split it into smaller files and import them one by one.`, 413, IMPORT_ERROR_CODES.TOO_MANY_ROWS);
    this.name = 'ImportTooManyRowsError';
  }
}

export class ImportValidationError extends ApplicationError {
  constructor(message: string, details?: unknown) {
    super(message, 422, IMPORT_ERROR_CODES.VALIDATION, details);
    this.name = 'ImportValidationError';
  }
}

/** The import is not in a state that allows the request (already started, say). */
export class ImportStateError extends ApplicationError {
  constructor(message: string) {
    super(message, 409, IMPORT_ERROR_CODES.STATE);
    this.name = 'ImportStateError';
  }
}

export class ImportAssignError extends ApplicationError {
  constructor(message: string, details?: unknown) {
    super(message, 422, IMPORT_ERROR_CODES.ASSIGN_INVALID, details);
    this.name = 'ImportAssignError';
  }
}
