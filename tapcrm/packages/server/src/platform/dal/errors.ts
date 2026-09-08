import { ERROR_CODES, HTTP_STATUS, type ErrorCode } from '@tapcrm/contracts';

/**
 * Failure taxonomy — TECH.md §9.8.
 *
 * FT-1: "The DAL classifies SQLSTATE/driver errors; MODULES NEVER INSPECT
 * DRIVER CODES to decide HTTP status." That rule is why this file exists in the
 * DAL and not in an error middleware next to the routes.
 *
 * FT-2: "503 and 409 are NEVER conflated. 503 means retry later; 409 means
 * state changed underneath the caller." They have different remedies and
 * telling a client to refetch when the database is saturated is wrong advice.
 */

export type FailureClass =
  | 'serialization_failure'
  | 'deadlock'
  | 'retry_exhausted'
  | 'ambiguous_commit'
  | 'unique_violation'
  | 'foreign_key_violation'
  | 'check_violation'
  | 'not_null_violation'
  | 'connection_failure'
  | 'statement_timeout'
  | 'insufficient_privilege'
  | 'unclassified';

export interface ClassifiedFailure {
  readonly failureClass: FailureClass;
  readonly retryable: boolean;
  readonly status: number;
  readonly code: ErrorCode;
  readonly message: string;
  /** FT-3 — a constraint failure that application validation should have caught. */
  readonly engineeringDefect: boolean;
  readonly sqlState: string | undefined;
}

const SQLSTATE: Record<string, Omit<ClassifiedFailure, 'sqlState' | 'message'>> = {
  // Retryable at the transaction level.
  '40001': {
    failureClass: 'serialization_failure',
    retryable: true,
    status: HTTP_STATUS.UNAVAILABLE,
    code: ERROR_CODES.SERVICE_UNAVAILABLE,
    engineeringDefect: false,
  },
  '40P01': {
    failureClass: 'deadlock',
    retryable: true,
    status: HTTP_STATUS.UNAVAILABLE,
    code: ERROR_CODES.SERVICE_UNAVAILABLE,
    engineeringDefect: false,
  },
  // Not retryable.
  '23505': {
    failureClass: 'unique_violation',
    retryable: false,
    status: HTTP_STATUS.CONFLICT,
    code: ERROR_CODES.DUPLICATE,
    engineeringDefect: false,
  },
  '23503': {
    failureClass: 'foreign_key_violation',
    retryable: false,
    status: HTTP_STATUS.UNPROCESSABLE,
    code: ERROR_CODES.NOT_ELIGIBLE,
    engineeringDefect: false,
  },
  '23514': {
    failureClass: 'check_violation',
    retryable: false,
    status: HTTP_STATUS.UNPROCESSABLE,
    code: ERROR_CODES.NOT_ELIGIBLE,
    // FT-3 — application validation should have caught this first.
    engineeringDefect: true,
  },
  '23502': {
    failureClass: 'not_null_violation',
    retryable: false,
    status: HTTP_STATUS.UNPROCESSABLE,
    code: ERROR_CODES.NOT_ELIGIBLE,
    engineeringDefect: true,
  },
  '57014': {
    failureClass: 'statement_timeout',
    retryable: false,
    status: HTTP_STATUS.UNAVAILABLE,
    code: ERROR_CODES.SERVICE_UNAVAILABLE,
    engineeringDefect: true,
  },
  '08000': {
    failureClass: 'connection_failure',
    retryable: false,
    status: HTTP_STATUS.UNAVAILABLE,
    code: ERROR_CODES.SERVICE_UNAVAILABLE,
    engineeringDefect: false,
  },
  '08006': {
    failureClass: 'connection_failure',
    retryable: false,
    status: HTTP_STATUS.UNAVAILABLE,
    code: ERROR_CODES.SERVICE_UNAVAILABLE,
    engineeringDefect: false,
  },
  // PG-3 — the app role hitting this means RLS or a REVOKE did its job, and
  // that the application tried something it should not have.
  '42501': {
    failureClass: 'insufficient_privilege',
    retryable: false,
    status: HTTP_STATUS.FORBIDDEN,
    code: ERROR_CODES.FORBIDDEN,
    engineeringDefect: true,
  },
};

function sqlStateOf(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error).code;
    if (typeof code === 'string') return code;
  }
  return undefined;
}

export function classifyDatabaseError(error: unknown): ClassifiedFailure {
  const sqlState = sqlStateOf(error);
  const message = error instanceof Error ? error.message : String(error);

  if (sqlState !== undefined) {
    const known = SQLSTATE[sqlState];
    if (known) return { ...known, sqlState, message };
  }

  // FT — "Anything unclassified → 500. Alerted and treated as a DEFECT until
  // classified." Not silently mapped to something plausible.
  return {
    failureClass: 'unclassified',
    retryable: false,
    status: HTTP_STATUS.INTERNAL,
    code: ERROR_CODES.INTERNAL_ERROR,
    engineeringDefect: true,
    sqlState,
    message,
  };
}

/**
 * Raised when the bounded retry budget is spent under contention.
 *
 * "Back off; the system is SATURATED, not logically invalid." Rendered as 503
 * with `Retry-After`, never as 409.
 */
export class RetryExhaustedError extends Error {
  readonly attempts: number;
  readonly lastFailure: ClassifiedFailure;

  constructor(attempts: number, lastFailure: ClassifiedFailure) {
    super(`Transaction retry budget of ${attempts} exhausted: ${lastFailure.failureClass}`);
    this.name = 'RetryExhaustedError';
    this.attempts = attempts;
    this.lastFailure = lastFailure;
  }
}

/**
 * TECH.md §9.7.1 — connection lost around COMMIT.
 *
 *   "outcome may be ambiguous → reconcile using idempotency key / durable
 *    command record → NEVER blindly repeat a non-idempotent mutation."
 */
export class AmbiguousCommitError extends Error {
  readonly idempotencyKey: string | null;

  constructor(idempotencyKey: string | null) {
    super(
      'The transaction outcome is ambiguous: the connection was lost around COMMIT. ' +
        'Reconcile by idempotency key rather than repeating the operation (TX-7).',
    );
    this.name = 'AmbiguousCommitError';
    this.idempotencyKey = idempotencyKey;
  }
}
