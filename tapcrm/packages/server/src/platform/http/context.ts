import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { ERROR_CODES, HTTP_STATUS, type Principal } from '@tapcrm/contracts';
import { createRequestContext } from '../dal/context.js';

/**
 * Pipeline step 1 — AUTHENTICATION AND ACCOUNT STATE.
 *
 *   "Valid token? Session version current? Account active?  Fail → 401"
 *
 * This runs before the router so that no handler can be reached without it.
 * `authorize()` asserts the context exists and fails closed if it does not.
 *
 * ⚠ SCAFFOLD: token verification and the session-version comparison are stubbed
 * pending the `identity` module. The SHAPE is correct — the middleware
 * constructs a RequestContext that cannot exist without a tenant (TN-5) — but
 * `resolvePrincipal` currently trusts a development header and MUST be replaced
 * before anything runs outside a developer's machine. It refuses to operate at
 * all when NODE_ENV is production.
 */

export function requestId(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header('x-request-id');
  const id = incoming && /^[\w-]{1,128}$/.test(incoming) ? incoming : randomUUID();
  res.setHeader('x-request-id', id);
  (req as Request & { requestId?: string }).requestId = id;
  next();
}

export interface PrincipalResolver {
  (req: Request): Promise<{ principal: Principal; organizationId: string } | null>;
}

let resolvePrincipal: PrincipalResolver = (req) => {
  if (process.env['NODE_ENV'] === 'production') {
    return Promise.reject(new Error(
      'No PrincipalResolver installed. The development header resolver is refused in ' +
        'production — install the identity module resolver at boot.',
    ));
  }

  const userId = req.header('x-dev-user-id');
  const organizationId = req.header('x-dev-organization-id');
  const accountType = req.header('x-dev-account-type') ?? 'employee';
  if (!userId || !organizationId) return Promise.resolve(null);

  return Promise.resolve({
    organizationId,
    principal: {
      id: userId,
      organizationId,
      accountType,
      sessionVersion: 1,
    } as Principal,
  });
};

/** Installed by the identity module at boot, replacing the development stub. */
export function installPrincipalResolver(resolver: PrincipalResolver): void {
  resolvePrincipal = resolver;
}

export function requestContext(req: Request, res: Response, next: NextFunction): void {
  void (async () => {
    try {
      const resolved = await resolvePrincipal(req);
      if (resolved === null) {
        res.status(HTTP_STATUS.UNAUTHENTICATED).json({
          success: false,
          code: ERROR_CODES.UNAUTHENTICATED,
          message: 'Authentication required',
        });
        return;
      }

      req.ctx = createRequestContext({
        organizationId: resolved.organizationId,
        principal: resolved.principal,
        requestId: (req as Request & { requestId?: string }).requestId ?? randomUUID(),
        sourceIp: req.ip ?? null,
      });

      next();
    } catch (error) {
      next(error);
    }
  })();
}
