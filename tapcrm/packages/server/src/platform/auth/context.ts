import type { NextFunction, Request, Response } from 'express';
import type { PlatformPrincipal } from '@tapcrm/contracts';
import { HTTP_STATUS } from '@tapcrm/contracts';
import { authenticate } from './service.js';
import { PlatformAuthenticationError, PlatformForbiddenError } from '../errors.js';

export interface PlatformRequestContext {
  readonly principal: PlatformPrincipal & { sessionId: string };
  readonly requestId: string;
  readonly sourceIp: string | null;
}

declare module 'express-serve-static-core' {
  interface Request {
    platformCtx?: PlatformRequestContext;
  }
}

export async function platformContext(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const header = req.header('authorization');
    if (!header?.startsWith('Bearer '))
      throw new PlatformAuthenticationError('Platform access token required');
    const token = header.slice(7).trim();
    if (!token) throw new PlatformAuthenticationError('Platform access token required');
    const principal = await authenticate(token);
    if (principal.role !== 'MASTER_ADMIN') throw new PlatformForbiddenError();
    const requestId = String(res.getHeader('x-request-id') ?? '');
    req.platformCtx = { principal, requestId, sourceIp: req.ip ?? null };
    next();
  } catch (error) {
    if (error instanceof PlatformAuthenticationError) {
      res
        .status(HTTP_STATUS.UNAUTHENTICATED)
        .json({ success: false, code: 'UNAUTHENTICATED', message: error.message });
      return;
    }
    next(error);
  }
}
