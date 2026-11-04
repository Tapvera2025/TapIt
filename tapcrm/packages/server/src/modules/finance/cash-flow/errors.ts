import { ApplicationError } from '../../../errors.js';

export class CashFlowError extends ApplicationError {
  constructor(message: string, status = 422, code = 'CASH_FLOW_VALIDATION_ERROR') {
    super(message, status, code);
    this.name = 'CashFlowError';
  }
}
