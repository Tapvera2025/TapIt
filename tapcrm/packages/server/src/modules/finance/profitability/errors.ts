import { ApplicationError } from '../../../errors.js';

export class ProfitabilityError extends ApplicationError {
  constructor(message: string, status = 422, code = 'PROFITABILITY_VALIDATION_ERROR') {
    super(message, status, code);
    this.name = 'ProfitabilityError';
  }
}
