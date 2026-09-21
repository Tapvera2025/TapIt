import { ApplicationError } from '../../errors.js';

export const ACCESS_ERROR_CODES = {
  DELEGATION_ROOT_OF_TRUST: 'ACCESS_DELEGATION_ROOT_OF_TRUST',
  DELEGATION_NOT_DELEGABLE: 'ACCESS_DELEGATION_NOT_DELEGABLE',
  DELEGATION_CEILING_EXCEEDED: 'ACCESS_DELEGATION_CEILING_EXCEEDED',
  DELEGATION_BOUNDARY: 'ACCESS_DELEGATION_BOUNDARY',
  DELEGATION_SENIORITY: 'ACCESS_DELEGATION_SENIORITY',
  OVERRIDE_SCOPE_INVALID_FOR_DOMAIN: 'ACCESS_OVERRIDE_SCOPE_INVALID_FOR_DOMAIN',
  OVERRIDE_NOT_FOUND: 'ACCESS_OVERRIDE_NOT_FOUND',
  UNKNOWN_ACTION: 'ACCESS_UNKNOWN_ACTION',
  USER_NOT_FOUND: 'ACCESS_USER_NOT_FOUND',
  ROLE_CHANGE_NOT_PENDING: 'ACCESS_ROLE_CHANGE_NOT_PENDING',
  ROLE_CHANGE_POSITION_INVALID: 'ACCESS_ROLE_CHANGE_POSITION_INVALID',
  ROLE_CHANGE_SELF: 'ACCESS_ROLE_CHANGE_SELF',
} as const;

/**
 * 422, not 403 — and the distinction is the point (NF-23b).
 *
 * By the time any of these is raised the framework has already asked "may this
 * principal call `access:delegate`?" and been answered yes; that is the 403.
 * What is refused here is the CONTENT of the proposed grant — "not this grant,
 * not with that scope" — so WF-4 applies and the unmet predicate is named in
 * `details` rather than left for the caller to guess.
 *
 * This matches `ORG_POSITION_POLICY_CEILING_EXCEEDED`, the same refusal on the
 * position-policy path.
 */
export class AccessValidationError extends ApplicationError {
  constructor(code: string, message: string, details?: unknown) {
    super(message, 422, code, details);
    this.name = 'AccessValidationError';
  }
}

export class AccessNotFoundError extends ApplicationError {
  constructor(code: string, message: string) {
    super(message, 404, code);
    this.name = 'AccessNotFoundError';
  }
}
