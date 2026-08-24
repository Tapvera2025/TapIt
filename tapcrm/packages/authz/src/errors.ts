import type { Action, DenialReason } from '@tapcrm/contracts';

/**
 * AZ-I1 — `authorize` THROWS on denial.
 *
 *   "A function returning `boolean` invites `if (can(...))` with a forgotten
 *    negation; a throwing function fails safe when a developer forgets to
 *    handle it."
 *
 * This maps to HTTP 403 — "not you". It must never be used for eligibility;
 * that is 422 and belongs to the module's state machine (NF-23b).
 */
export class AuthorizationError extends Error {
  readonly action: Action;
  readonly reason: DenialReason;
  /** The constraint id (A1..A4, P1..P8) when a constraint denied. */
  readonly constraintId: string | undefined;

  constructor(action: Action, reason: DenialReason, detail?: string, constraintId?: string) {
    super(detail ?? `Denied ${action}: ${reason}`);
    this.name = 'AuthorizationError';
    this.action = action;
    this.reason = reason;
    this.constraintId = constraintId;
  }
}

/**
 * A defect in the system's own configuration, not a denial.
 *
 * Distinguished from AuthorizationError because it must page an engineer rather
 * than tell a user to ask for access. PD-1 is the canonical case: evaluating
 * `all-people` against a business-domain resource is "a PROGRAMMING ERROR that
 * fails closed and logs as a defect, not a permission denial."
 *
 * It still denies. It is simply denial for a different reason with a different
 * remedy.
 */
export class AuthorizationConfigError extends Error {
  readonly action: Action | null;
  readonly defect: string;

  constructor(defect: string, action: Action | null = null) {
    super(`Authorization configuration defect: ${defect}`);
    this.name = 'AuthorizationConfigError';
    this.action = action;
    this.defect = defect;
  }
}
