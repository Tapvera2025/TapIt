import { ApplicationError } from '../../../errors.js';

export class PayablesError extends ApplicationError {
  constructor(message: string, status = 422, code = 'PAYABLES_VALIDATION_ERROR') {
    super(message, status, code);
    this.name = 'PayablesError';
  }
}
