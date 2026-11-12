import { ApplicationError } from '../../../errors.js';

export const TELEPHONY_ERROR_CODES = {
  NOT_FOUND: 'TELEPHONY_NOT_FOUND',
  VALIDATION: 'TELEPHONY_VALIDATION_ERROR',
  SETUP_REQUIRED: 'TELEPHONY_SETUP_REQUIRED',
  CREDENTIALS_REJECTED: 'TELEPHONY_CREDENTIALS_REJECTED',
  CREDENTIALS_UNREADABLE: 'TELEPHONY_CREDENTIALS_UNREADABLE',
  PROVIDER_UNAVAILABLE: 'TELEPHONY_PROVIDER_UNAVAILABLE',
  RATE_LIMITED: 'TELEPHONY_RATE_LIMITED',
  NOT_ELIGIBLE: 'TELEPHONY_NOT_ELIGIBLE',
  NO_RECORDING: 'TELEPHONY_NO_RECORDING',
} as const;

export class TelephonyNotFoundError extends ApplicationError {
  constructor(what = 'Call integration record') {
    super(`${what} not found`, 404, TELEPHONY_ERROR_CODES.NOT_FOUND);
  }
}

export class TelephonyValidationError extends ApplicationError {
  constructor(message: string, details?: unknown) {
    super(message, 422, TELEPHONY_ERROR_CODES.VALIDATION, details);
  }
}

/** The connection exists but is in a state that cannot do what was asked. */
export class TelephonyNotEligibleError extends ApplicationError {
  constructor(message: string, unmet: string, actual: unknown) {
    super(message, 422, TELEPHONY_ERROR_CODES.NOT_ELIGIBLE, { unmet: [unmet], actual });
  }
}

export class TelephonySetupRequiredError extends ApplicationError {
  constructor(message: string) {
    super(message, 422, TELEPHONY_ERROR_CODES.SETUP_REQUIRED);
  }
}

export class TelephonyNoRecordingError extends ApplicationError {
  constructor(message = 'This call has no recording or voicemail to play.') {
    super(message, 404, TELEPHONY_ERROR_CODES.NO_RECORDING);
  }
}

/**
 * The calling platform said no, or could not be reached. `kind` lets the sync
 * decide whether to stop (rejected keys) or retry later (outage, rate limit).
 */
export class ProviderError extends ApplicationError {
  constructor(
    message: string,
    public readonly kind: 'rejected' | 'unavailable' | 'rate-limited' | 'not-found' | 'invalid-response',
    public readonly httpStatus: number | null,
  ) {
    super(
      message,
      kind === 'rejected' || kind === 'not-found' ? 422 : kind === 'rate-limited' ? 429 : 502,
      kind === 'rejected'
        ? TELEPHONY_ERROR_CODES.CREDENTIALS_REJECTED
        : kind === 'rate-limited'
          ? TELEPHONY_ERROR_CODES.RATE_LIMITED
          : TELEPHONY_ERROR_CODES.PROVIDER_UNAVAILABLE,
    );
    this.name = 'ProviderError';
  }
}

/** Raised by the sync when its request budget for one run is used up. */
export class SyncBudgetExhausted extends Error {
  constructor() {
    super('Sync request budget used up for this run');
    this.name = 'SyncBudgetExhausted';
  }
}
