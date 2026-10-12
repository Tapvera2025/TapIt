import type { Request, Response } from 'express';
import { z } from 'zod';
import { requestPasswordReset, resetPassword } from '../password/reset.js';
import { devInstantPasswordReset } from '../password/dev-reset.js';
import { isLocalRequest, runningInContainer } from '../password/local-request.js';

export async function requestPasswordResetController(req: Request, res: Response): Promise<void> {
  const body = z.object({ email: z.string().trim().email().max(320) }).parse(req.body ?? {});
  await requestPasswordReset(body.email);
  res.status(202).json({ success: true, data: { accepted: true } });
}

export async function resetPasswordController(req: Request, res: Response): Promise<void> {
  const body = z.object({ token: z.string().min(20), password: z.string().min(12).max(200), organizationCode: z.string().trim().min(2).max(32) }).parse(req.body ?? {});
  await resetPassword(body.token, body.password, body.organizationCode);
  res.status(200).json({ success: true, data: { reset: true } });
}

/**
 * DEVELOPMENT ONLY (DEV_INSTANT_PASSWORD_RESET). Registered only when the flag
 * is on; see password/dev-reset.ts.
 */
export async function devInstantPasswordResetController(req: Request, res: Response): Promise<void> {
  const local = isLocalRequest({
    remoteAddress: req.socket.remoteAddress,
    forwardedFor: req.headers['x-forwarded-for'],
    origin: req.headers.origin,
  }, runningInContainer());
  if (!local) {
    res.status(403).json({
      success: false,
      code: 'IDENTITY_DEV_RESET_LOCAL_ONLY',
      message: 'Instant password reset only answers requests made from the machine running the API.',
    });
    return;
  }
  const body = z.object({ email: z.string().trim().email().max(320) }).parse(req.body ?? {});
  const result = await devInstantPasswordReset(body.email, req.ip ?? null);
  console.warn(JSON.stringify({ level: 'warn', msg: 'DEV_INSTANT_PASSWORD_RESET: generated a new admin password', email: result.email }));
  res.set('Cache-Control', 'no-store');
  res.status(200).json({ success: true, data: result });
}
