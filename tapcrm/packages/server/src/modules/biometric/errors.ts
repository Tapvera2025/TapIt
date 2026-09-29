import { ApplicationError } from '../../errors.js';

export const BIOMETRIC_ERROR_CODES = {
  NOT_TENANT_WIDE: 'BIOMETRIC_NOT_TENANT_WIDE',
  SERIAL_TAKEN: 'BIOMETRIC_SERIAL_TAKEN',
  DEVICE_NOT_FOUND: 'BIOMETRIC_DEVICE_NOT_FOUND',
  CONNECTOR_NOT_FOUND: 'BIOMETRIC_CONNECTOR_NOT_FOUND',
  CONNECTOR_KIND_MISMATCH: 'BIOMETRIC_CONNECTOR_KIND_MISMATCH',
  PERSON_NOT_FOUND: 'BIOMETRIC_PERSON_NOT_FOUND',
  TIMEZONE_INVALID: 'BIOMETRIC_TIMEZONE_INVALID',
  TRUSTED_KEYS_REQUIRED: 'BIOMETRIC_TRUSTED_KEYS_REQUIRED',
  LIVE_NOT_AVAILABLE: 'BIOMETRIC_LIVE_NOT_AVAILABLE',
  PIN_HELD: 'BIOMETRIC_PIN_HELD',
  RANGE_INVALID: 'BIOMETRIC_RANGE_INVALID',
  NOTHING_TO_REPLAY: 'BIOMETRIC_NOTHING_TO_REPLAY',
} as const;

export class BiometricValidationError extends ApplicationError {
  constructor(code: string, message: string, details?: unknown) {
    super(message, 422, code, details);
    this.name = 'BiometricValidationError';
  }
}

export class BiometricForbiddenError extends ApplicationError {
  constructor(code: string, message: string) {
    super(message, 403, code);
    this.name = 'BiometricForbiddenError';
  }
}

export class BiometricNotFoundError extends ApplicationError {
  constructor(code: string, message: string) {
    super(message, 404, code);
    this.name = 'BiometricNotFoundError';
  }
}

export class BiometricConflictError extends ApplicationError {
  constructor(code: string, message: string, details?: unknown) {
    super(message, 409, code, details);
    this.name = 'BiometricConflictError';
  }
}
