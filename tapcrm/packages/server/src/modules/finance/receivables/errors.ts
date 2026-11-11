import { ApplicationError } from '../../../errors.js';

export class ReceivablesValidationError extends ApplicationError {
  constructor(message: string) {
    super(message, 422, 'RECEIVABLES_VALIDATION_ERROR');
    this.name = 'ReceivablesValidationError';
  }
}

export class ReceivablesNotFoundError extends ApplicationError {
  constructor(message: string) {
    super(message, 404, 'RECEIVABLES_NOT_FOUND');
    this.name = 'ReceivablesNotFoundError';
  }
}
