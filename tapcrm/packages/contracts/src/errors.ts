/**
 * Error codes and the failure taxonomy — TECH.md §8.2 and §9.8.
 *
 * The distinction that matters, and the reason this file exists:
 *
 *   403 = "Not you."            → the authorization engine refused.
 *   422 = "Not this record, not yet." → the record is ineligible.
 *
 * NF-23b: conflating them turns every commercial policy change into a change
 * to the security-critical component. A 422 always names the unmet predicate,
 * because a 422 without one produces a support ticket every time (WF-4).
 */

export const ERROR_CODES = {
  // 400
  MALFORMED_REQUEST: 'MALFORMED_REQUEST',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  // 401
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  SESSION_VERSION_STALE: 'SESSION_VERSION_STALE',
  /** ID-4 — prove the factor you already hold. */
  MFA_REQUIRED: 'MFA_REQUIRED',
  /** ID-4 — a factor is mandatory for this account and none is enrolled yet. */
  MFA_ENROLMENT_REQUIRED: 'MFA_ENROLMENT_REQUIRED',
  /** ID-5a — an email code does not satisfy a privileged position. */
  MFA_ASSURANCE_TOO_LOW: 'MFA_ASSURANCE_TOO_LOW',
  // 403 — "not you"
  FORBIDDEN: 'FORBIDDEN',
  /** ID-16 / ID-15d — refused on location, and appealable. */
  GEOFENCE_DENIED: 'GEOFENCE_DENIED',
  // 404 — CP-2: client isolation returns 404, never 403. A 403 would confirm
  // that the record exists, which is itself a disclosure across the boundary.
  NOT_FOUND: 'NOT_FOUND',
  // 409
  CONFLICT: 'CONFLICT',
  DUPLICATE: 'DUPLICATE',
  STALE_VERSION: 'STALE_VERSION',
  // 422 — "not this record, not yet"
  NOT_ELIGIBLE: 'NOT_ELIGIBLE',
  // 429
  RATE_LIMITED: 'RATE_LIMITED',
  // 500 / 503
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  AMBIGUOUS_OUTCOME: 'AMBIGUOUS_OUTCOME',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/** Why an authorization decision denied. Surfaced in metrics, never to clients. */
export type DenialReason =
  | 'unknown_action'
  | 'no_policy'
  | 'not_allowed'
  | 'out_of_scope'
  | 'constraint'
  | 'absolute_constraint'
  | 'privileged_constraint'
  | 'sod_self'
  | 'sod_unresolved'
  | 'domain_mismatch'
  | 'client_boundary'
  | 'service_not_permitted'
  | 'expired_credential';

/** Body shape for a 422. `unmet` is mandatory — see WF-4. */
export interface EligibilityDetails {
  readonly unmet: readonly string[];
  readonly required?: readonly string[];
  readonly actual?: unknown;
}

export interface ApiErrorBody {
  readonly success: false;
  /**
   * Usually an `ErrorCode`, but module state machines mint their own 422 codes
   * (`DEAL_NOT_ELIGIBLE`, TECH.md §8.2), so this is deliberately widened.
   */
  readonly code: string;
  readonly message: string;
  readonly details?: unknown;
}
