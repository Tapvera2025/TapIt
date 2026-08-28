import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { ERROR_CODES, HTTP_STATUS, type Principal } from '@tapcrm/contracts';
import { createRequestContext } from '../dal/context.js';

export const requestId: RequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const incoming = req.header('x-request-id');
  const id = incoming && /^[\w-]{1,128}$/.test(incoming) ? incoming : randomUUID();
  res.setHeader('x-request-id', id);
  (req as Request & { requestId?: string }).requestId = id;
  next();
};

export interface PrincipalResolution {
  readonly principal: Principal;
  readonly organizationId: string;
  readonly sessionId: string;
}

export interface PrincipalResolver {
  (req: Request): Promise<PrincipalResolution | null>;
}
let resolvePrincipal: PrincipalResolver = async () => {
  throw new Error('No PrincipalResolver installed.');
};
export function installPrincipalResolver(resolver: PrincipalResolver): void {
  resolvePrincipal = resolver;
}

export const requestContext: RequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  void (async () => {
    try {
      const resolved = await resolvePrincipal(req);
      if (resolved === null) {
        res
          .status(HTTP_STATUS.UNAUTHENTICATED)
          .json({
            success: false,
            code: ERROR_CODES.UNAUTHENTICATED,
            message: 'Authentication required',
          });
        return;
      }
      req.authSessionId = resolved.sessionId;
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
};
