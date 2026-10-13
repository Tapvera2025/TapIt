import { PlatformValidationError } from '../../platform/errors.js';

export class ExpenseError extends PlatformValidationError {
  constructor(message: string) {
    super(message);
    this.name = 'ExpenseError';
  }
}
