import { createHash, randomUUID } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { loadConfig } from '../../../config.js';
import { IdentityAuthenticationError } from '../errors.js';

const encoder = new TextEncoder();

function accessSecret(): Uint8Array { return encoder.encode(loadConfig().JWT_ACCESS_SECRET); }
function refreshSecret(): Uint8Array { return encoder.encode(loadConfig().JWT_REFRESH_SECRET); }

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function createFamilyId(): string { return randomUUID(); }

export async function signIdentityAccessToken(input: {
  userId: string;
  organizationId: string;
  sessionId: string;
  sessionVersion: number;
  accountType: string;
}): Promise<string> {
  const config = loadConfig();
  return new SignJWT({ typ: 'identity-access', organizationId: input.organizationId, sessionId: input.sessionId, sessionVersion: input.sessionVersion, accountType: input.accountType })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(input.userId)
    .setIssuedAt()
    .setExpirationTime(`${config.ACCESS_TOKEN_TTL_SECONDS}s`)
    .sign(accessSecret());
}

export async function verifyIdentityAccessToken(token: string) {
  try {
    const { payload } = await jwtVerify(token, accessSecret(), { algorithms: ['HS256'] });
    if (payload['typ'] !== 'identity-access' || typeof payload.sub !== 'string' || typeof payload['organizationId'] !== 'string' || typeof payload['sessionId'] !== 'string' || typeof payload['sessionVersion'] !== 'number' || typeof payload['accountType'] !== 'string') throw new Error('invalid claims');
    return { userId: payload.sub, organizationId: payload['organizationId'], sessionId: payload['sessionId'], sessionVersion: payload['sessionVersion'], accountType: payload['accountType'] };
  } catch {
    throw new IdentityAuthenticationError('IDENTITY_ACCESS_TOKEN_INVALID');
  }
}

export async function signIdentityRefreshToken(sessionId: string, organizationId: string, familyId: string) {
  const config = loadConfig();
  return new SignJWT({ typ: 'identity-refresh', sessionId, organizationId, familyId })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt()
    .setExpirationTime(`${config.REFRESH_TOKEN_TTL_SECONDS}s`)
    .sign(refreshSecret());
}

export async function verifyIdentityRefreshToken(token: string) {
  try {
    const { payload } = await jwtVerify(token, refreshSecret(), { algorithms: ['HS256'] });
    if (payload['typ'] !== 'identity-refresh' || typeof payload['sessionId'] !== 'string' || typeof payload['organizationId'] !== 'string' || typeof payload['familyId'] !== 'string') throw new Error('invalid claims');
    return { sessionId: payload['sessionId'], organizationId: payload['organizationId'], familyId: payload['familyId'] };
  } catch {
    throw new IdentityAuthenticationError('IDENTITY_REFRESH_TOKEN_INVALID');
  }
}
