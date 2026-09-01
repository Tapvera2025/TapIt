/**
 * Authentication failures — the ones that happen before a principal exists, and
 * therefore before the authorization engine has anything to say.
 *
 * These are deliberately separate from `AuthorizationError` (403, "not you")
 * and `NotEligibleError` (422, "not this record, not yet"). Authentication
 * failing is a 401: there is no principal, so there is nothing to permit or
 * refuse.
 *
 * Every message here is written for the person reading it. NF-13: "Every
 * permission-denied state explains what is missing and who can grant it.
 * 'Access denied' with no path forward generates a support request." The same
 * logic applies to a refused sign-in — except where saying more would leak
 * something, which is why `InvalidCredentialsError` says nothing specific.
 */

/**
 * Wrong password, unknown account, unknown organization, locked account.
 *
 * Deliberately one error with one message for all of them. Distinguishing "no
 * such user" from "wrong password" turns the login form into an account
 * directory, and there is no version of that trade that is worth making.
 */
export class InvalidCredentialsError extends Error {
  constructor() {
    super('Those sign-in details are not correct.');
    this.name = 'InvalidCredentialsError';
  }
}

export class InvalidSessionError extends Error {
  constructor(detail = 'Your session is no longer valid. Please sign in again.') {
    super(detail);
    this.name = 'InvalidSessionError';
  }
}

/** ID-9 — the account or the source address is barred for now. */
export class AccountLockedError extends Error {
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super(
      'Too many failed sign-in attempts. This account is temporarily locked. ' +
        'It unlocks automatically, and HR or a Super Admin can release it sooner.',
    );
    this.name = 'AccountLockedError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** ID-9 — the progressive-delay tier, returned rather than slept through. */
export class TooManyAttemptsError extends Error {
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super(`Too many attempts. Please wait ${String(retryAfterSeconds)} seconds and try again.`);
    this.name = 'TooManyAttemptsError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class MfaRequiredError extends Error {
  constructor() {
    super('Multi-factor authentication is required.');
    this.name = 'MfaRequiredError';
  }
}

/**
 * ID-4 — the account must hold a second factor and does not have one yet.
 *
 * Distinct from `MfaRequiredError`, which means "now prove the factor you
 * already have". This one means no usable factor exists, so no session can be
 * issued until one is enrolled. Returning a session and asking nicely
 * afterwards would make the requirement advisory.
 */
export class MfaEnrolmentRequiredError extends Error {
  readonly requiresHighAssurance: boolean;
  readonly enrolmentToken: string;

  constructor(enrolmentToken: string, requiresHighAssurance: boolean) {
    super(
      requiresHighAssurance
        ? 'This account must be protected by a passkey or an authenticator app before it ' +
            'can be used. A code sent to your email is not sufficient for this role.'
        : 'This account must be protected by a second factor before it can be used.',
    );
    this.name = 'MfaEnrolmentRequiredError';
    this.enrolmentToken = enrolmentToken;
    this.requiresHighAssurance = requiresHighAssurance;
  }
}

/**
 * ID-5a — a low-assurance factor was offered where a high-assurance one is
 * required.
 */
export class AssuranceTooLowError extends Error {
  constructor() {
    super(
      'A code sent to your email is not accepted for this role. Use a passkey or an ' +
        'authenticator app.',
    );
    this.name = 'AssuranceTooLowError';
  }
}

/** ID-13 to ID-18b — the sign-in was refused on location. */
export class GeofenceDeniedError extends Error {
  readonly detail: string;

  constructor(detail: string) {
    super(detail);
    this.name = 'GeofenceDeniedError';
    this.detail = detail;
  }
}

export class RequestValidationError extends Error {
  readonly issues: readonly unknown[];

  constructor(issues: readonly unknown[]) {
    super('Request validation failed');
    this.name = 'RequestValidationError';
    this.issues = issues;
  }
}
