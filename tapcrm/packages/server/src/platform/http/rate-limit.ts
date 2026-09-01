import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ERROR_CODES, HTTP_STATUS } from '@tapcrm/contracts';
import { getCounterStore } from '../security/counters.js';

/**
 * HTTP rate limiting — SE-5.
 *
 *   "Rate limiting on authentication, export, bulk and search endpoints."
 *
 * Distinct from the brute-force lockout in `modules/identity/security.ts`,
 * which counts failed attempts against one account. This counts REQUESTS
 * against one source, whether they succeed or fail, and it is what stops
 * someone from walking the login endpoint across ten thousand accounts, or
 * pulling the same export in a loop until the database gives up.
 *
 * The counters live in Redis for the same reason the lockout does: a limit that
 * resets on deploy and does not span replicas is a limit an attacker gets for
 * free (see `platform/security/counters.ts`).
 *
 * Every response carries the standard headers, because a client that cannot see
 * the limit cannot back off politely, and a well-behaved integration hammering
 * blindly is indistinguishable from an attack.
 */

interface Rule {
  readonly name: string;
  readonly test: (req: Request) => boolean;
  readonly limit: number;
  readonly windowMs: number;
  /** Per source address, or per authenticated principal where one exists. */
  readonly by: 'address' | 'principal';
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/**
 * Deliberately few, deliberately generous. A limit tight enough to catch a
 * determined attacker is usually tight enough to catch a busy real user on a
 * shared office address, and the first time that happens the limit gets raised
 * to something meaningless. These are sized to stop automation, not to shape
 * traffic.
 */
const RULES: readonly Rule[] = [
  {
    name: 'auth',
    test: (req) => req.path.startsWith('/api/auth/'),
    limit: 30,
    windowMs: 5 * MINUTE,
    by: 'address',
  },
  {
    name: 'export',
    // AU-7 — "Audit export is Super Admin only, is itself audited, and is
    // RATE-LIMITED."
    test: (req) => req.path.includes('/export') || req.path.startsWith('/api/reports/'),
    limit: 20,
    windowMs: HOUR,
    by: 'principal',
  },
  {
    name: 'search',
    test: (req) => req.path.includes('/search') || req.path.startsWith('/api/workspace/search'),
    limit: 120,
    windowMs: MINUTE,
    by: 'principal',
  },
  {
    name: 'bulk',
    test: (req) => req.path.includes('/bulk') || req.path.includes('/import'),
    limit: 10,
    windowMs: HOUR,
    by: 'principal',
  },
];

function subjectOf(req: Request, rule: Rule): string {
  if (rule.by === 'principal' && req.ctx !== undefined) {
    return `u:${req.ctx.principal.id}`;
  }
  return `a:${req.ip ?? 'unknown'}`;
}

export function rateLimiters(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const rule = RULES.find((candidate) => candidate.test(req));
    if (rule === undefined) {
      next();
      return;
    }

    void (async () => {
      try {
        const key = `rl:${rule.name}:${subjectOf(req, rule)}`;
        const hit = await getCounterStore().hit(key, rule.windowMs);
        const remaining = Math.max(rule.limit - hit.count, 0);

        res.setHeader('RateLimit-Limit', rule.limit);
        res.setHeader('RateLimit-Remaining', remaining);
        res.setHeader('RateLimit-Reset', Math.ceil((hit.resetAt - Date.now()) / 1000));

        if (hit.count > rule.limit) {
          const retryAfter = Math.max(Math.ceil((hit.resetAt - Date.now()) / 1000), 1);
          res.setHeader('Retry-After', retryAfter);
          res.status(HTTP_STATUS.RATE_LIMITED).json({
            success: false,
            code: ERROR_CODES.RATE_LIMITED,
            message: `Too many requests. Try again in ${String(retryAfter)} seconds.`,
            details: { retryAfterSeconds: retryAfter },
          });
          return;
        }

        next();
      } catch (error) {
        // The store being unreachable must not take the product down with it.
        // A rate limiter that fails closed turns a cache outage into a full
        // outage; the brute-force lockout and the authorization engine are both
        // still standing behind this.
        console.error(
          JSON.stringify({
            level: 'error',
            msg: 'rate limiter unavailable, allowing request',
            err: error instanceof Error ? error.message : String(error),
          }),
        );
        next();
      }
    })();
  };
}
