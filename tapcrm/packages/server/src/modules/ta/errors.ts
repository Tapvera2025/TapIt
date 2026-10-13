import { ApplicationError } from '../../errors.js';

export class TaError extends ApplicationError {
  constructor(message: string, status = 400) {
    super(message, status, 'TA_VALIDATION');
    this.name = 'TaError';
  }
}

export class TaConflictError extends TaError {
  constructor(message: string) {
    super(message, 409);
    this.name = 'TaConflictError';
  }
}
