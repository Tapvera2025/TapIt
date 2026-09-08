import { createHash, randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import { SignJWT, jwtVerify } from 'jose';
import type { PlatformPrincipal } from '@tapcrm/contracts';
import { loadConfig } from '../../config.js';
import { PlatformAuthenticationError } from '../errors.js';

const encoder = new TextEncoder();

function accessSecret(): Uint8Array {
  return encoder.encode(loadConfig().JWT_ACCESS_SECRET);
}
function refreshSecret(): Uint8Array {
  return encoder.encode(loadConfig().JWT_REFRESH_SECRET);
}

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id });
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

export function createOpaqueToken(bytes = 48): string {
  return randomBytes(bytes).toString('base64url');
}

export function hashToken(token: string): Buffer {
  return createHash('sha256').update(token).digest();
}

export async function signAccessToken(
  principal: PlatformPrincipal,
  sessionId: string,
): Promise<string> {
  const config = loadConfig();
  return new SignJWT({
    typ: 'platform-access',
    platformUserId: principal.platformUserId,
    role: principal.role,
    sessionVersion: principal.sessionVersion,
    sessionId,
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(principal.id)
    .setIssuedAt()
    .setExpirationTime(`${config.ACCESS_TOKEN_TTL_SECONDS}s`)
    .sign(accessSecret());
}

export async function verifyAccessToken(
  token: string,
): Promise<PlatformPrincipal & { sessionId: string }> {
  try {
    const { payload } = await jwtVerify(token, accessSecret(), { algorithms: ['HS256'] });
    if (payload['typ'] !== 'platform-access' || payload['role'] !== 'MASTER_ADMIN')
      throw new Error('invalid platform token');
    if (
      typeof payload.sub !== 'string' ||
      typeof payload['platformUserId'] !== 'string' ||
      typeof payload['sessionId'] !== 'string' ||
      typeof payload['sessionVersion'] !== 'number'
    )
      throw new Error('invalid claims');
    return {
      id: payload.sub,
      platformUserId: payload['platformUserId'],
      role: 'MASTER_ADMIN',
      sessionVersion: payload['sessionVersion'],
      sessionId: payload['sessionId'],
    };
  } catch {
    throw new PlatformAuthenticationError('Invalid or expired platform access token');
  }
}

export async function signRefreshToken(
  sessionId: string,
  familyId: string,
): Promise<string> {
  const config = loadConfig();
  return new SignJWT({ typ: 'platform-refresh', sessionId, familyId })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt()
    .setExpirationTime(`${config.REFRESH_TOKEN_TTL_SECONDS}s`)
    .sign(refreshSecret());
}

export async function verifyRefreshToken(
  token: string,
): Promise<{ sessionId: string; familyId: string }> {
  try {
    const { payload } = await jwtVerify(token, refreshSecret(), {
      algorithms: ['HS256'],
    });
    if (
      payload['typ'] !== 'platform-refresh' ||
      typeof payload['sessionId'] !== 'string' ||
      typeof payload['familyId'] !== 'string'
    )
      throw new Error('invalid claims');
    return { sessionId: payload['sessionId'], familyId: payload['familyId'] };
  } catch {
    throw new PlatformAuthenticationError('Invalid or expired platform refresh token');
  }
}
