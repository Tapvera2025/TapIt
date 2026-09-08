import { randomUUID } from 'node:crypto';
import { loadConfig } from '../../config.js';
import { PlatformAuthenticationError } from '../errors.js';
import {
  hashToken,
  signAccessToken,
  signRefreshToken,
  verifyPassword,
  verifyRefreshToken,
  hashPassword,
} from './crypto.js';
import * as repo from './repository.js';

export function validatePassword(password: string): void {
  if (password.length < 12) throw new Error('Password must be at least 12 characters');
}

export async function login(input: {
  email: string;
  password: string;
  deviceLabel?: string;
  ip: string | null;
  userAgent: string | null;
}) {
  const user = await repo.findUserByEmail(input.email);
  if (
    !user ||
    user.status !== 'active' ||
    !(await verifyPassword(user.passwordHash, input.password))
  ) {
    throw new PlatformAuthenticationError('Invalid platform credentials');
  }
  const config = loadConfig();
  const expiresAt = new Date(Date.now() + config.REFRESH_TOKEN_TTL_SECONDS * 1000);
  const session = await repo.createSession({
    userId: user.id,
    sessionVersion: user.sessionVersion,
    deviceLabel: input.deviceLabel ?? null,
    ip: input.ip,
    userAgent: input.userAgent,
    expiresAt,
  });
  const familyId = randomUUID();
  const refresh = await signRefreshToken(session.id, familyId);
  await repo.insertRefresh({
    sessionId: session.id,
    tokenHash: hashToken(refresh),
    familyId,
    parentId: null,
    expiresAt,
  });
  const access = await signAccessToken(
    {
      id: user.id,
      platformUserId: user.id,
      role: user.role,
      sessionVersion: user.sessionVersion,
    },
    session.id,
  );
  return {
    accessToken: access,
    refreshToken: refresh,
    expiresIn: config.ACCESS_TOKEN_TTL_SECONDS,
    user: { id: user.id, email: user.email, fullName: user.fullName, role: user.role },
  };
}

export async function refresh(rawRefresh: string) {
  const claims = await verifyRefreshToken(rawRefresh);
  const user = await repo.findUserById(
    (await repo.findSessionUserId(claims.sessionId)) ?? '',
  );
  if (!user || user.status !== 'active')
    throw new PlatformAuthenticationError('Platform session is no longer active');
  if (!(await repo.sessionIsCurrent(claims.sessionId, user.id, user.sessionVersion)))
    throw new PlatformAuthenticationError('Platform session expired');
  const config = loadConfig();
  const expiresAt = new Date(Date.now() + config.REFRESH_TOKEN_TTL_SECONDS * 1000);
  const newRefresh = await signRefreshToken(claims.sessionId, claims.familyId);
  try {
    await repo.rotateRefresh({
      tokenHash: hashToken(rawRefresh),
      sessionId: claims.sessionId,
      familyId: claims.familyId,
      newTokenHash: hashToken(newRefresh),
      expiresAt,
    });
  } catch {
    await repo.revokeRefreshFamily(claims.familyId);
    throw new PlatformAuthenticationError(
      'Refresh token reuse detected; platform session family revoked',
    );
  }
  const access = await signAccessToken(
    {
      id: user.id,
      platformUserId: user.id,
      role: user.role,
      sessionVersion: user.sessionVersion,
    },
    claims.sessionId,
  );
  return {
    accessToken: access,
    refreshToken: newRefresh,
    expiresIn: config.ACCESS_TOKEN_TTL_SECONDS,
  };
}

export async function createPasswordHash(password: string): Promise<string> {
  validatePassword(password);
  return hashPassword(password);
}

export async function logout(sessionId: string): Promise<void> {
  await repo.revokeSession(sessionId);
}

export async function authenticate(accessToken: string) {
  const { verifyAccessToken } = await import('./crypto.js');
  const principal = await verifyAccessToken(accessToken);
  if (
    !(await repo.sessionIsCurrent(
      principal.sessionId,
      principal.platformUserId,
      principal.sessionVersion,
    ))
  )
    throw new PlatformAuthenticationError('Platform session expired');
  await repo.touchSession(principal.sessionId);
  return principal;
}
