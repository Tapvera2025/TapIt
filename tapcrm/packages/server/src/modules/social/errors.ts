import { ApplicationError } from '../../errors.js';

export class SocialNotFoundError extends ApplicationError {
  constructor(resource = 'Social media record') {
    super(`${resource} not found`, 404, 'SOCIAL_NOT_FOUND');
  }
}
export class SocialValidationError extends ApplicationError {
  constructor(message: string, details?: unknown) {
    super(message, 422, 'SOCIAL_VALIDATION_FAILED', details);
  }
}
export class SocialConflictError extends ApplicationError {
  constructor(message: string) {
    super(message, 409, 'SOCIAL_CONFLICT');
  }
}
