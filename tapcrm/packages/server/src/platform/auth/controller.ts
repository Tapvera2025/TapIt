import type { Request, Response } from 'express';
import { login, refresh, logout } from './service.js';

export async function loginController(req: Request, res: Response): Promise<void> {
  const body = (req.body ?? {}) as {
    email?: unknown;
    password?: unknown;
    deviceLabel?: unknown;
  };
  const result = await login({
    email: typeof body.email === 'string' ? body.email : '',
    password: typeof body.password === 'string' ? body.password : '',
    ...(typeof body.deviceLabel === 'string' ? { deviceLabel: body.deviceLabel } : {}),
    ip: req.ip ?? null,
    userAgent: req.get('user-agent') ?? null,
  });
  res.status(200).json({ success: true, data: result });
}

export async function refreshController(req: Request, res: Response): Promise<void> {
  const body = (req.body ?? {}) as { refreshToken?: unknown };
  const token = typeof body.refreshToken === 'string' ? body.refreshToken : '';
  const result = await refresh(token);
  res.status(200).json({ success: true, data: result });
}

export async function logoutController(req: Request, res: Response): Promise<void> {
  if (!req.platformCtx) throw new Error('Platform context missing');
  await logout(req.platformCtx.principal.sessionId);
  res.status(200).json({ success: true, data: { loggedOut: true } });
}
