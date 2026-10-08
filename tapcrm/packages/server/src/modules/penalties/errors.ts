import { PlatformValidationError } from '../../platform/errors.js';

export class PenaltyError extends PlatformValidationError {
  constructor(message: string) {
    super(message);
    this.name = 'PenaltyError';
  }
}
