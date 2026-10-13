import { ApplicationError } from '../../errors.js';

export class VerificationNotFoundError extends ApplicationError {
  constructor(message = 'Verification record or document not found') {
    super(message, 404, 'VERIFICATION_NOT_FOUND');
    this.name = 'VerificationNotFoundError';
  }
}

export class VerificationValidationError extends ApplicationError {
  constructor(message: string, details?: unknown) {
    super(message, 400, 'VERIFICATION_VALIDATION_ERROR', details);
    this.name = 'VerificationValidationError';
  }
}

