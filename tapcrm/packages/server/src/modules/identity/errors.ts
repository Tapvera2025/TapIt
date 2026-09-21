import { ApplicationError } from '../../errors.js';

export const IDENTITY_ERROR_CODES = {
  INVALID_CREDENTIALS: 'IDENTITY_INVALID_CREDENTIALS',
  ACCESS_TOKEN_INVALID: 'IDENTITY_ACCESS_TOKEN_INVALID',
  SESSION_EXPIRED: 'IDENTITY_SESSION_EXPIRED',
  REFRESH_TOKEN_INVALID: 'IDENTITY_REFRESH_TOKEN_INVALID',
  REFRESH_TOKEN_REUSE: 'IDENTITY_REFRESH_TOKEN_REUSE',
  SESSION_NOT_FOUND: 'IDENTITY_SESSION_NOT_FOUND',
  LOCATION_REQUIRED: 'IDENTITY_LOCATION_REQUIRED',
  LOCATION_ACCURACY_TOO_LOW: 'IDENTITY_LOCATION_ACCURACY_TOO_LOW',
  LOCATION_NOT_ALLOWED: 'IDENTITY_LOCATION_NOT_ALLOWED',
  USER_NOT_FOUND: 'IDENTITY_USER_NOT_FOUND',
  PASSWORD_RESET_INVALID: 'IDENTITY_PASSWORD_RESET_INVALID',
  INVITATION_NOT_FOUND: 'IDENTITY_INVITATION_NOT_FOUND',
  INVITATION_INVALID: 'IDENTITY_INVITATION_INVALID',
  ORGANIZATION_SUSPENDED: 'IDENTITY_ORGANIZATION_SUSPENDED',
  PASSWORD_CHANGE_REQUIRED: 'IDENTITY_PASSWORD_CHANGE_REQUIRED',
  ACCOUNT_LOCKED: 'IDENTITY_ACCOUNT_LOCKED',
  UNLOCK_NOT_ALLOWED: 'IDENTITY_UNLOCK_NOT_ALLOWED',
  UNLOCK_TARGET_NOT_FOUND: 'IDENTITY_UNLOCK_TARGET_NOT_FOUND',
  UNLOCK_TARGET_DEACTIVATED: 'IDENTITY_UNLOCK_TARGET_DEACTIVATED',
  SUPER_ADMIN_EXISTS: 'IDENTITY_SUPER_ADMIN_EXISTS',
} as const;

type IdentityAuthenticationCode =
  | typeof IDENTITY_ERROR_CODES.INVALID_CREDENTIALS
  | typeof IDENTITY_ERROR_CODES.ACCESS_TOKEN_INVALID
  | typeof IDENTITY_ERROR_CODES.SESSION_EXPIRED
  | typeof IDENTITY_ERROR_CODES.REFRESH_TOKEN_INVALID
  | typeof IDENTITY_ERROR_CODES.REFRESH_TOKEN_REUSE
  | typeof IDENTITY_ERROR_CODES.ORGANIZATION_SUSPENDED
  | typeof IDENTITY_ERROR_CODES.PASSWORD_CHANGE_REQUIRED
  | typeof IDENTITY_ERROR_CODES.ACCOUNT_LOCKED;

const DEFAULT_AUTH_MESSAGES: Record<IdentityAuthenticationCode, string> = {
  IDENTITY_INVALID_CREDENTIALS: 'Invalid credentials',
  IDENTITY_ACCESS_TOKEN_INVALID: 'Invalid or expired identity access token',
  IDENTITY_SESSION_EXPIRED: 'Identity session expired',
  IDENTITY_REFRESH_TOKEN_INVALID: 'Invalid or expired identity refresh token',
  IDENTITY_REFRESH_TOKEN_REUSE: 'Refresh token reuse detected; session family revoked',
  IDENTITY_ORGANIZATION_SUSPENDED: 'Company access is suspended',
  IDENTITY_PASSWORD_CHANGE_REQUIRED: 'Password change required before CRM access',
  IDENTITY_ACCOUNT_LOCKED: 'Too many sign-in attempts. Try again later.',
};

export class IdentityAuthenticationError extends ApplicationError {
  constructor(code: IdentityAuthenticationCode, message = DEFAULT_AUTH_MESSAGES[code], status = 401) {
    super(message, status, code);
    this.name = 'IdentityAuthenticationError';
  }
}

export class IdentityValidationError extends ApplicationError {
  constructor(code: string, message: string) {
    super(message, 422, code);
    this.name = 'IdentityValidationError';
  }
}

export class IdentityServiceUnavailableError extends ApplicationError {
  constructor(code: string, message: string) {
    super(message, 503, code);
    this.name = 'IdentityServiceUnavailableError';
  }
}

export class IdentityConflictError extends ApplicationError {
  constructor(code: string, message: string) {
    super(message, 409, code);
    this.name = 'IdentityConflictError';
  }
}

export class IdentityNotFoundError extends ApplicationError {
  constructor(code: string, message: string) {
    super(message, 404, code);
    this.name = 'IdentityNotFoundError';
  }
}
