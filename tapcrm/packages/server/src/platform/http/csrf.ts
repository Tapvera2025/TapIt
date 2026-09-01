import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ERROR_CODES, HTTP_STATUS } from '@tapcrm/contracts';
import { loadConfig } from '../../config.js';

/**
 * CSRF protection — ID-19.
 *
 *   "If session authentication uses cookies, CSRF protection is mandatory on
 *    every state-changing request."
 *
 * Authentication here is an `httpOnly` cookie, which the browser attaches to
 * requests the user's page did not make. That is the whole attack: a form on
 * some other site posts to this API and the browser helpfully signs it.
 *
 * Two independent checks, because each one fails in a different situation.
 *
 *   Double-submit token. A random value is issued in a readable cookie and must
 *   be echoed in a header. An attacker on another origin can cause the cookie
 *   to be SENT but cannot READ it, so they cannot produce the header. This is
 *   the primary control.
 *
 *   Origin allow-list. `Origin` is set by the browser on every cross-site
 *   state-changing request and cannot be forged by page script. It catches the
 *   case where the token cookie leaked some other way.
 *
 * `SameSite=Lax` on the session cookie is a third layer and deliberately not
 * relied on: it is a browser default rather than something this application
 * enforces, it does nothing for a same-site subdomain, and the day anyone needs
 * `SameSite=None` for an embedded portal it disappears without a code change.
 * A control that vanishes when a configuration flag moves is not a control.
 */

export const CSRF_COOKIE = 'tapcrm_csrf';
export const CSRF_HEADER = 'x-csrf-token';

/** Safe methods do not change state, so they are not gated (RFC 9110 §9.2.1). */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Routes reached before a session exists, where there is no cookie for an
 * attacker to ride and therefore nothing to protect against.
 *
 * Refresh is deliberately NOT on this list: it is reached with a cookie, and
 * forcing a token rotation from another origin is exactly the kind of nuisance
 * this control exists to stop.
 */
const EXEMPT_PATHS = new Set([
  '/api/auth/login',
  '/api/auth/signup',
  '/api/auth/mfa/challenge',
  '/api/auth/verify-email',
  '/api/auth/forgot-password',
  '/api/auth/reset-password',
]);

export function issueCsrfToken(res: Response): string {
  const token = randomBytes(32).toString('base64url');
  res.cookie(CSRF_COOKIE, token, {
    // Deliberately readable by script: the client has to echo it in a header,
    // and a value the page cannot read is a value it cannot send. The secret
    // that matters — the session — stays httpOnly.
    httpOnly: false,
    secure: loadConfig().NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 24 * 60 * 60 * 1000,
  });
  return token;
}

export function clearCsrfToken(res: Response): void {
  res.clearCookie(CSRF_COOKIE, {
    httpOnly: false,
    secure: loadConfig().NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
  });
}

/** Constant-time, and length-safe: `timingSafeEqual` throws on a length mismatch. */
function tokensMatch(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length || left.length === 0) return false;
  return timingSafeEqual(left, right);
}

function originAllowed(req: Request): boolean {
  const origin = req.get('origin');
  // No Origin header means a same-origin non-browser caller (curl, a server, a
  // test). Those are not CSRF vectors — CSRF needs a browser holding a cookie.
  if (origin === undefined || origin === '') return true;

  const allowed = loadConfig()
    .CORS_ORIGIN.split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  return allowed.includes(origin);
}

export const csrfProtection: RequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  if (SAFE_METHODS.has(req.method) || EXEMPT_PATHS.has(req.path)) {
    next();
    return;
  }

  const reject = (message: string): void => {
    res.status(HTTP_STATUS.FORBIDDEN).json({
      success: false,
      code: ERROR_CODES.FORBIDDEN,
      message,
    });
  };

  if (!originAllowed(req)) {
    reject('This request came from an origin this application does not accept.');
    return;
  }

  const cookieToken = (req.cookies as Record<string, unknown> | undefined)?.[CSRF_COOKIE];
  const headerToken = req.get(CSRF_HEADER);

  if (typeof cookieToken !== 'string' || headerToken === undefined) {
    reject(
      'This request is missing its security token. Reload the page and try again.',
    );
    return;
  }

  if (!tokensMatch(cookieToken, headerToken)) {
    reject('This request could not be verified. Reload the page and try again.');
    return;
  }

  next();
};
