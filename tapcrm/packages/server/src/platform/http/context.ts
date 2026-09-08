import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { ERROR_CODES, HTTP_STATUS, type Principal } from '@tapcrm/contracts';
import { createRequestContext } from '../dal/context.js';
import { bootstrapDb } from '../dal/db.js';
import { sql } from '../dal/sql.js';

/**
 * Pipeline step 1 — AUTHENTICATION AND ACCOUNT STATE.
 *
 *   "Valid token? Session version current? Account active?  Fail → 401"
 *
 * This runs before the router so that no handler can be reached without it.
 * `authorize()` asserts the context exists and fails closed if it does not.
 *
 * The default resolver fails closed. The Identity module owns installation for
 * every normal application environment; no development header is trusted here.
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

type ResolverOwner = 'identity' | 'development-bypass';

let resolverOwner: ResolverOwner | null = null;
let resolvePrincipal: PrincipalResolver = async () => null;

/** Install the authoritative Identity resolver once during application boot. */
export function installPrincipalResolver(resolver: PrincipalResolver): void {
  if (resolverOwner === 'identity') return;
  if (resolverOwner !== null) {
    throw new Error(`Cannot install Identity resolver after ${resolverOwner} resolver`);
  }
  resolverOwner = 'identity';
  resolvePrincipal = resolver;
}

/**
 * Explicit test/development-only replacement for the Identity resolver.
 * Normal startup never calls this function.
 */
export function installDevelopmentPrincipalResolver(resolver: PrincipalResolver): void {
  if (resolverOwner !== 'identity') {
    throw new Error('Identity resolver must be installed before the development bypass');
  }
  resolverOwner = 'development-bypass';
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

      const organization = await bootstrapDb.readAs<{ status: string }>(
        resolved.organizationId,
        sql`SELECT status FROM organization WHERE id = ${resolved.organizationId}`,
      );
      if (organization[0]?.status !== 'active') {
        res.status(HTTP_STATUS.FORBIDDEN).json({
          success: false,
          code: ERROR_CODES.FORBIDDEN,
          message: 'Company access is suspended',
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
