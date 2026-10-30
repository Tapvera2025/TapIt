import { ApplicationError } from '../../../errors.js';

export const FINANCE_FOUNDATION_ERROR_CODES = {
  VALIDATION_FAILED: 'FINANCE_FOUNDATION_VALIDATION_FAILED',
  VERSION_CONFLICT: 'FINANCE_FOUNDATION_VERSION_CONFLICT',
} as const;

export class FinanceFoundationValidationError extends ApplicationError {
  constructor(message: string, code = FINANCE_FOUNDATION_ERROR_CODES.VALIDATION_FAILED) {
    super(message, 422, code);
    this.name = 'FinanceFoundationValidationError';
  }
}

export class FinanceFoundationVersionConflictError extends ApplicationError {
  constructor() {
    super('Finance settings changed since they were loaded. Refresh and try again.', 409, FINANCE_FOUNDATION_ERROR_CODES.VERSION_CONFLICT);
    this.name = 'FinanceFoundationVersionConflictError';
  }
}
