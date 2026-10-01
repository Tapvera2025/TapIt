import { ApplicationError } from '../../errors.js';

export const CLIENT_ERROR_CODES = {
  NOT_FOUND: 'CLIENT_NOT_FOUND',
  EMAIL_TAKEN: 'CLIENT_EMAIL_TAKEN',
  VALIDATION_FAILED: 'CLIENT_VALIDATION_FAILED',
} as const;

export class ClientNotFoundError extends ApplicationError {
  constructor() {
    super('Client not found', 404, CLIENT_ERROR_CODES.NOT_FOUND);
  }
}

export class ClientEmailTakenError extends ApplicationError {
  constructor(email: string) {
    super('That email is already in use', 409, CLIENT_ERROR_CODES.EMAIL_TAKEN, { email });
  }
}

export class ClientValidationError extends ApplicationError {
  constructor(message: string, details?: unknown) {
    super(message, 422, CLIENT_ERROR_CODES.VALIDATION_FAILED, details);
  }
}
