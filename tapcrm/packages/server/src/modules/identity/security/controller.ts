import type { Request, Response } from 'express';
import { z } from 'zod';
import { requestPasswordReset, resetPassword } from '../password/reset.js';

export async function requestPasswordResetController(req: Request, res: Response): Promise<void> {
  const body = z.object({ email: z.string().trim().email().max(320) }).parse(req.body ?? {});
  await requestPasswordReset(body.email);
  res.status(202).json({ success: true, data: { accepted: true } });
}

export async function resetPasswordController(req: Request, res: Response): Promise<void> {
  const body = z.object({ token: z.string().min(20), password: z.string().min(12).max(200) }).parse(req.body ?? {});
  await resetPassword(body.token, body.password);
  res.status(200).json({ success: true, data: { reset: true } });
}
