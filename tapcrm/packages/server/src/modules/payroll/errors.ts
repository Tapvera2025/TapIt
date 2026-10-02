import { ApplicationError } from '../../errors.js';

/**
 * Payroll's refusals. Each names what is wrong and what to do about it, so the
 * screen can show the message as it stands; nothing here is a 500.
 */
export const PAYROLL_ERROR_CODES = {
  NOT_FOUND: 'PAYROLL_NOT_FOUND',
  NO_CONFIG: 'PAYROLL_NO_CONFIG',
  NO_EMPLOYEES: 'PAYROLL_NO_EMPLOYEES',
  RUN_EXISTS: 'PAYROLL_RUN_EXISTS',
  WRONG_STATUS: 'PAYROLL_WRONG_STATUS',
  POPULATION_CHANGED: 'PAYROLL_POPULATION_CHANGED',
  CONFIG_CHANGED: 'PAYROLL_CONFIG_CHANGED',
  MISSING_SLIP: 'PAYROLL_MISSING_SLIP',
  ALREADY_PUBLISHED: 'PAYROLL_ALREADY_PUBLISHED',
  NOT_PUBLISHABLE: 'PAYROLL_NOT_PUBLISHABLE',
  NOT_PUBLISHED: 'PAYROLL_NOT_PUBLISHED',
  STRUCTURE_OVERLAP: 'PAYROLL_STRUCTURE_OVERLAP',
  STRUCTURE_INVALID: 'PAYROLL_STRUCTURE_INVALID',
  NOT_AN_EMPLOYEE: 'PAYROLL_NOT_AN_EMPLOYEE',
  CONFIG_EXISTS: 'PAYROLL_CONFIG_EXISTS',
  CONFIG_NOT_ACTIVE: 'PAYROLL_CONFIG_NOT_ACTIVE',
  INPUT_NOT_FOUND: 'PAYROLL_INPUT_NOT_FOUND',
} as const;

export class PayrollNotFoundError extends ApplicationError {
  constructor(message: string, code: string = PAYROLL_ERROR_CODES.NOT_FOUND) {
    super(message, 404, code);
    this.name = 'PayrollNotFoundError';
  }
}

/** The request is well formed, but this record is not ready for it (422). */
export class PayrollValidationError extends ApplicationError {
  constructor(code: string, message: string, details?: unknown) {
    super(message, 422, code, details);
    this.name = 'PayrollValidationError';
  }
}

/** The run or record is in a state that refuses this step (409). */
export class PayrollConflictError extends ApplicationError {
  constructor(code: string, message: string, details?: unknown) {
    super(message, 409, code, details);
    this.name = 'PayrollConflictError';
  }
}

/** "August 2026" for a first-of-month date. */
export function monthLabel(periodStart: string): string {
  return new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${periodStart}T12:00:00Z`),
  );
}
