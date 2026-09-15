import type { Request, Response } from 'express';
import { login, refresh, logout, getActiveSessions, revokeOneSession, revokeEverySession } from './service.js';
import { loginSchema, refreshSchema } from './validators.js';
import { IdentityAuthenticationError } from './errors.js';
import { changeTemporaryPassword } from './password/change.js';
import { z } from 'zod';
import { loadConfig } from '../../config.js';

export async function loginController(req: Request, res: Response): Promise<void> {
  const body = loginSchema.parse(req.body ?? {});
  const countryHeader = loadConfig().TRUSTED_IP_COUNTRY_HEADER;
  const countryCode = countryHeader ? req.get(countryHeader)?.trim().toUpperCase() : undefined;
  const result = await login({
    email: body.email,
    password: body.password,
    ...(body.deviceLabel === undefined ? {} : { deviceLabel: body.deviceLabel }),
    ...(body.latitude === undefined ? {} : { latitude: body.latitude }),
    ...(body.longitude === undefined ? {} : { longitude: body.longitude }),
    ...(body.accuracyMetres === undefined ? {} : { accuracyMetres: body.accuracyMetres }),
    ip: req.ip ?? null,
    userAgent: req.get('user-agent') ?? null,
    ...(countryCode && /^[A-Z]{2}$/.test(countryCode) ? { countryCode } : {}),
  });
  res.status(200).json({ success: true, data: result });
}

export async function refreshController(req: Request, res: Response): Promise<void> {
  const token = refreshSchema.parse(req.body ?? {}).refreshToken;
  const result = await refresh(token);
  res.status(200).json({ success: true, data: result });
}

export async function logoutController(req: Request, res: Response): Promise<void> {
  await logout(req);
  res.status(200).json({ success: true, data: { loggedOut: true } });
}

function bearerToken(req: Request): string {
  const header = req.header('authorization');
  if (!header?.startsWith('Bearer ')) throw new IdentityAuthenticationError('IDENTITY_ACCESS_TOKEN_INVALID');
  return header.slice(7).trim();
}

export async function changeTemporaryPasswordController(req: Request, res: Response): Promise<void> {
  const body = z.object({ currentPassword: z.string().min(1).max(200), newPassword: z.string().min(12).max(200) }).parse(req.body ?? {});
  await changeTemporaryPassword({ accessToken: bearerToken(req), currentPassword: body.currentPassword, newPassword: body.newPassword });
  res.status(200).json({ success: true, data: { passwordChanged: true, loginRequired: true } });
}

export async function listSessionsController(req: Request, res: Response): Promise<void> {
  const sessions = await getActiveSessions(bearerToken(req));
  res.status(200).json({ success: true, data: sessions });
}

export async function revokeSessionController(req: Request, res: Response): Promise<void> {
  const sessionId = req.params['id'];
  const result = await revokeOneSession(bearerToken(req), typeof sessionId === 'string' ? sessionId : '');
  res.status(200).json({ success: true, data: { revoked: true, current: result.current } });
}

export async function revokeAllSessionsController(req: Request, res: Response): Promise<void> {
  const result = await revokeEverySession(bearerToken(req));
  res.status(200).json({ success: true, data: { revoked: true, current: result.current } });
}
