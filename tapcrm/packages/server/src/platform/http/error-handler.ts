import type { NextFunction, Request, Response } from 'express';
import { AuthorizationError, AuthorizationConfigError } from '@tapcrm/authz';
import { ERROR_CODES, HTTP_STATUS, type ApiErrorBody } from '@tapcrm/contracts';
import {
  classifyDatabaseError,
  RetryExhaustedError,
  AmbiguousCommitError,
} from '../dal/errors.js';
import { MissingTenantContextError } from '../dal/context.js';
import { EmptyWriteError, TenantSurfaceViolationError } from '../dal/db.js';
import {
  AccountLockedError,
  AssuranceTooLowError,
  GeofenceDeniedError,
  InvalidCredentialsError,
  InvalidSessionError,
  MfaEnrolmentRequiredError,
  MfaRequiredError,
  RequestValidationError,
  TooManyAttemptsError,
} from './auth-error.js';

/**
 * The single place an error becomes a status code — TECH.md §8.2, §9.8.
 *
 * The distinction this file exists to preserve:
 *
 *   403  "Not you."                     → ask for access
 *   404  "Not visible to this caller."  → client isolation (CP-2)
 *   422  "Not this record, not yet."    → complete the missing step
 *   409  state changed underneath you   → refetch and re-apply
 *   503  the system is saturated        → back off and retry
 *
 * FT-2: 503 and 409 are never conflated.
 */

/**
 * Raised by a module's state machine. NF-23b keeps this strictly separate from
 * AuthorizationError: "A 403 means 'not you'; a 422 means 'not this record, not
 * yet' — with the unmet predicate named."
 *
 * SM-4 requires the unmet predicate, and WF-4 explains why: "A 422 without the
 * unmet predicate produces a support ticket every time."
 */
export class NotEligibleError extends Error {
  readonly code: string;
  readonly unmet: readonly string[];
  readonly required: readonly string[] | undefined;
  readonly actual: unknown;

  constructor(
    code: string,
    message: string,
    details: { unmet: readonly string[]; required?: readonly string[]; actual?: unknown },
  ) {
    super(message);
    this.name = 'NotEligibleError';
    this.code = code;
    this.unmet = details.unmet;
    this.required = details.required;
    this.actual = details.actual;

    if (details.unmet.length === 0) {
      throw new Error(
        'A 422 must name at least one unmet predicate (WF-4). An eligibility failure ' +
          'the caller cannot act on is a support ticket.',
      );
    }
  }
}

export class NotFoundError extends Error {
  constructor(what: string) {
    super(`${what} not found`);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends Error {
  readonly conflictingKey: string | undefined;
  constructor(message: string, conflictingKey?: string) {
    super(message);
    this.name = 'ConflictError';
    this.conflictingKey = conflictingKey;
  }
}

interface Mapped {
  status: number;
  body: ApiErrorBody;
  headers?: Record<string, string>;
  /** Logged at error level and alerted; the client never sees the detail. */
  defect?: boolean;
}

function mapError(error: unknown): Mapped {
  /* ---- Authentication errors: 401 Unauthorized ---- */
  if (error instanceof InvalidCredentialsError) {
    return {
      status: HTTP_STATUS.UNAUTHENTICATED,
      body: {
        success: false,
        code: ERROR_CODES.UNAUTHENTICATED,
        message: error.message,
      },
    };
  }

  if (error instanceof InvalidSessionError) {
    return {
      status: HTTP_STATUS.UNAUTHENTICATED,
      body: {
        success: false,
        code: ERROR_CODES.SESSION_EXPIRED,
        message: error.message,
      },
    };
  }

  /* ---- ID-9 — barred, with an honest Retry-After ---- */
  if (error instanceof AccountLockedError || error instanceof TooManyAttemptsError) {
    return {
      status: HTTP_STATUS.RATE_LIMITED,
      headers: { 'Retry-After': String(error.retryAfterSeconds) },
      body: {
        success: false,
        code: ERROR_CODES.RATE_LIMITED,
        message: error.message,
        details: { retryAfterSeconds: error.retryAfterSeconds },
      },
    };
  }

  /* ---- ID-4 — a factor is required and none is enrolled ---- */
  if (error instanceof MfaEnrolmentRequiredError) {
    return {
      status: HTTP_STATUS.UNAUTHENTICATED,
      body: {
        success: false,
        code: ERROR_CODES.MFA_ENROLMENT_REQUIRED,
        message: error.message,
        // The client needs both to render the enrolment step: the token that
        // authorises it, and whether a low-assurance factor would be accepted.
        details: {
          enrolmentToken: error.enrolmentToken,
          requiresHighAssurance: error.requiresHighAssurance,
        },
      },
    };
  }

  /* ---- ID-5a — the offered factor is not strong enough ---- */
  if (error instanceof AssuranceTooLowError) {
    return {
      status: HTTP_STATUS.UNAUTHENTICATED,
      body: {
        success: false,
        code: ERROR_CODES.MFA_ASSURANCE_TOO_LOW,
        message: error.message,
      },
    };
  }

  /* ---- ID-16 — "denied with a specific, actionable message" ---- */
  if (error instanceof GeofenceDeniedError) {
    return {
      status: HTTP_STATUS.FORBIDDEN,
      body: {
        success: false,
        code: ERROR_CODES.GEOFENCE_DENIED,
        message: error.message,
        // ID-15d — a denial is appealable, so the response says so rather than
        // leaving the person at a dead end.
        details: { appealable: true },
      },
    };
  }

  if (error instanceof MfaRequiredError) {
    return {
      status: HTTP_STATUS.UNAUTHENTICATED,
      body: {
        success: false,
        code: ERROR_CODES.MFA_REQUIRED,
        message: error.message,
      },
    };
  }

  /* ---- A write that should have changed something and did not ---- */
  if (error instanceof EmptyWriteError) {
    // Almost always a lost race (the row was already revoked, consumed or
    // deleted by a concurrent request), which is a 409 for the caller: refetch
    // and re-apply. It is logged as a defect too, because the other cause —
    // missing tenant context — looks identical from here and must not stay
    // invisible.
    return {
      status: HTTP_STATUS.CONFLICT,
      defect: true,
      body: {
        success: false,
        code: ERROR_CODES.CONFLICT,
        message: 'That item has already changed. Reload and try again.',
      },
    };
  }

  /* ---- MT-5 — a cross-tenant surface aimed at tenant data ---- */
  if (error instanceof TenantSurfaceViolationError) {
    return {
      status: HTTP_STATUS.INTERNAL,
      defect: true,
      body: { success: false, code: ERROR_CODES.INTERNAL_ERROR, message: 'Internal error' },
    };
  }

  if (error instanceof RequestValidationError) {
    return {
      status: HTTP_STATUS.BAD_REQUEST,
      body: {
        success: false,
        code: ERROR_CODES.VALIDATION_FAILED,
        message: error.message,
        details: { issues: error.issues },
      },
    };
  }

  /* ---- Authorization: 403, or 404 across a client boundary ---- */
  if (error instanceof AuthorizationError) {
    // A2 / CP-2 — client isolation returns 404, NEVER 403. A 403 would confirm
    // the record exists, which is itself a disclosure across the boundary the
    // constraint defends.
    if (error.constraintId === 'A2' || error.reason === 'client_boundary') {
      return {
        status: HTTP_STATUS.NOT_FOUND,
        body: { success: false, code: ERROR_CODES.NOT_FOUND, message: 'Not found' },
      };
    }
    return {
      status: HTTP_STATUS.FORBIDDEN,
      body: {
        success: false,
        code: ERROR_CODES.FORBIDDEN,
        message: error.message,
        // NF-13 — "Every permission-denied state explains what is missing and
        // who can grant it. 'Access denied' with no path forward generates a
        // support request."
        details: {
          action: error.action,
          constraint: error.constraintId ?? null,
          remedy: error.constraintId
            ? `Governed by protected constraint ${error.constraintId}. This is not configurable.`
            : 'Request this capability from Super Admin or a delegate who holds it.',
        },
      },
    };
  }

  /* ---- Eligibility: 422 with the unmet predicate named ---- */
  if (error instanceof NotEligibleError) {
    return {
      status: HTTP_STATUS.UNPROCESSABLE,
      body: {
        success: false,
        code: error.code,
        message: error.message,
        details: { unmet: error.unmet, required: error.required, actual: error.actual },
      },
    };
  }

  if (error instanceof NotFoundError) {
    return {
      status: HTTP_STATUS.NOT_FOUND,
      body: { success: false, code: ERROR_CODES.NOT_FOUND, message: error.message },
    };
  }

  if (error instanceof ConflictError) {
    return {
      status: HTTP_STATUS.CONFLICT,
      body: {
        success: false,
        code: ERROR_CODES.CONFLICT,
        message: error.message,
        details: error.conflictingKey ? { key: error.conflictingKey } : undefined,
      },
    };
  }

  /* ---- Saturation and ambiguity: 503, never 409 ---- */
  if (error instanceof RetryExhaustedError) {
    return {
      status: HTTP_STATUS.UNAVAILABLE,
      headers: { 'Retry-After': '2' },
      body: {
        success: false,
        code: ERROR_CODES.SERVICE_UNAVAILABLE,
        message: 'The system is under contention. Retry shortly.',
      },
    };
  }

  if (error instanceof AmbiguousCommitError) {
    return {
      status: HTTP_STATUS.UNAVAILABLE,
      body: {
        success: false,
        code: ERROR_CODES.AMBIGUOUS_OUTCOME,
        message: error.message,
        details: { idempotencyKey: error.idempotencyKey },
      },
    };
  }

  /* ---- Defects: deny, but page an engineer ---- */
  if (error instanceof AuthorizationConfigError || error instanceof MissingTenantContextError) {
    return {
      status: HTTP_STATUS.INTERNAL,
      defect: true,
      body: {
        success: false,
        code: ERROR_CODES.INTERNAL_ERROR,
        message: 'Internal error',
      },
    };
  }

  /* ---- Database ---- */
  const classified = classifyDatabaseError(error);
  if (classified.failureClass !== 'unclassified') {
    return {
      status: classified.status,
      defect: classified.engineeringDefect,
      body: {
        success: false,
        code: classified.code,
        message:
          classified.status >= 500
            ? 'Internal error'
            : `Request could not be completed: ${classified.failureClass}`,
      },
    };
  }

  return {
    status: HTTP_STATUS.INTERNAL,
    defect: true,
    body: { success: false, code: ERROR_CODES.INTERNAL_ERROR, message: 'Internal error' },
  };
}

/** `req.route` is untyped in Express; narrow it rather than trusting `any`. */
function routePathOf(req: Request): string {
  const route: unknown = req.route;
  if (typeof route === 'object' && route !== null && 'path' in route) {
    const { path } = route;
    if (typeof path === 'string') return path;
  }
  return req.path;
}

export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const mapped = mapError(error);

  // Observability §13 — "Never log a payslip amount, a deal's commercials, a
  // notepad body or a geofence coordinate." Only the shape of the failure is
  // logged, never the record.
  const log = {
    level: mapped.defect ? 'error' : 'warn',
    msg: 'request failed',
    status: mapped.status,
    code: mapped.body.code,
    method: req.method,
    route: routePathOf(req),
    requestId: res.getHeader('x-request-id'),
    defect: mapped.defect ?? false,
    err: error instanceof Error ? error.message : String(error),
  };
  console[mapped.defect ? 'error' : 'warn'](JSON.stringify(log));

  if (mapped.headers) {
    for (const [key, value] of Object.entries(mapped.headers)) res.setHeader(key, value);
  }
  res.status(mapped.status).json(mapped.body);
}
