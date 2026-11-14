import { ApplicationError } from '../../../../errors.js';

export class AccountingCompletionError extends ApplicationError {
  constructor(message: string, status = 422) {
    super(message, status, status === 404 ? 'ACCOUNTING_COMPLETION_NOT_FOUND' : 'ACCOUNTING_COMPLETION_VALIDATION_FAILED');
    this.name = 'AccountingCompletionError';
  }
}
