import { PlatformValidationError } from '../../platform/errors.js';
export class AdvanceError extends PlatformValidationError {
  constructor(message: string) {
    super(message);
    this.name = 'AdvanceError';
  }
}
