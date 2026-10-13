/**
 * Sales v1.1 R2 — Public proposal portal routes (R2 plan step 2.10).
 *
 * These routes have NO authentication and NO tenant context: the recipient
 * holds a token that resolves to a specific commercials version and the
 * tenant it belongs to. Mount this router BEFORE `requestContext`
 * middleware (see app.ts) so the handlers run with no `req.ctx`.
 *
 * Security posture per the threat model:
 *   - raw token never logged (we hash it on the way in; logs carry a
 *     prefix only)
 *   - `X-Robots-Tag: noindex, nofollow, noarchive` on every response
 *   - `Referrer-Policy: no-referrer` so clicking a link out of this page
 *     doesn't leak the token in the Referer header
 *   - request body hard-limited by the global express.json() 15mb cap;
 *     endpoints only consume short string fields
 */

import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  acceptProposal,
  recordQuestion,
  viewProposal,
  type PortalRequestMetadata,
} from './service.js';
import { redactToken } from './token.js';

const acceptBodySchema = z.object({
  comment: z.string().trim().max(2000).optional(),
}).default({});

const questionBodySchema = z.object({
  comment: z.string().trim().min(1).max(2000),
});

function readToken(req: Request): string {
  const value = req.params['token'];
  return (Array.isArray(value) ? value[0] : value) ?? '';
}

function readIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  const header = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  if (header) {
    const first = header.split(',')[0]?.trim();
    if (first) return first;
  }
  return req.socket.remoteAddress ?? '';
}

function readUserAgent(req: Request): string {
  const value = req.headers['user-agent'];
  return (Array.isArray(value) ? value[0] : value) ?? '';
}

function meta(req: Request): PortalRequestMetadata {
  return { ip: readIp(req), userAgent: readUserAgent(req) };
}

function applySecurityHeaders(res: Response): void {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cache-Control', 'private, no-store');
}

export function buildPublicProposalPortalRouter(): Router {
  const router = Router();

  router.use((_req, res, next) => {
    applySecurityHeaders(res);
    next();
  });

  router.get('/:token', async (req: Request, res: Response, next: NextFunction) => {
    const rawToken = readToken(req);
    try {
      const card = await viewProposal(rawToken, meta(req));
      res.status(200).json({ success: true, data: card });
    } catch (error) {
      annotateRedactedToken(error, rawToken);
      next(error);
    }
  });

  router.post('/:token/accept', async (req: Request, res: Response, next: NextFunction) => {
    const rawToken = readToken(req);
    try {
      const parsed = acceptBodySchema.parse(req.body ?? {});
      const result = await acceptProposal(rawToken, parsed, meta(req));
      res.status(result.alreadyAccepted ? 200 : 201).json({ success: true, data: result });
    } catch (error) {
      annotateRedactedToken(error, rawToken);
      next(error);
    }
  });

  router.post('/:token/question', async (req: Request, res: Response, next: NextFunction) => {
    const rawToken = readToken(req);
    try {
      const parsed = questionBodySchema.parse(req.body ?? {});
      const result = await recordQuestion(rawToken, parsed, meta(req));
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      annotateRedactedToken(error, rawToken);
      next(error);
    }
  });

  return router;
}

function annotateRedactedToken(error: unknown, rawToken: string): void {
  if (error && typeof error === 'object') {
    try {
      (error as { tokenRef?: string }).tokenRef = redactToken(rawToken);
    } catch {
      // best-effort annotation — never let logging prep crash the handler
    }
  }
}
