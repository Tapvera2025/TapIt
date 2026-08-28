import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import { createHash, randomBytes } from 'node:crypto';
import { loadConfig } from '../../config.js';

export interface AccessTokenPayload extends JWTPayload {
  readonly sub: string;
  readonly org: string;
  readonly typ: 'super-admin' | 'employee' | 'client' | 'service';
  readonly ver: number;
  readonly sid: string;
}

export interface MfaChallengePayload extends JWTPayload {
  readonly sub: string;
  readonly org: string;
  readonly typ: 'super-admin' | 'employee' | 'client' | 'service';
  readonly ver: number;
  readonly requiresHighAssurance: boolean;
}

export async function signAccessToken(
  payload: Omit<AccessTokenPayload, 'iat' | 'exp'>,
): Promise<string> {
  const config = loadConfig();
  const secret = new TextEncoder().encode(config.JWT_ACCESS_SECRET);

  return new SignJWT(payload)
    .setProtectedHeader({
      alg: 'HS256',
      typ: 'JWT',
    })
    .setIssuer('tapcrm')
    .setAudience('tapcrm-api')
    .setIssuedAt()
    .setExpirationTime(`${config.ACCESS_TOKEN_TTL_SECONDS}s`)
    .sign(secret);
}

export async function verifyAccessToken(
  token: string,
): Promise<AccessTokenPayload | null> {
  try {
    const config = loadConfig();
    const secret = new TextEncoder().encode(config.JWT_ACCESS_SECRET);

    const { payload } = await jwtVerify(token, secret, {
      algorithms: ['HS256'],
      issuer: 'tapcrm',
      audience: 'tapcrm-api',
    });

    if (
      typeof payload.sub !== 'string' ||
      typeof payload['org'] !== 'string' ||
      typeof payload['typ'] !== 'string' ||
      typeof payload['ver'] !== 'number' ||
      typeof payload['sid'] !== 'string'
    ) {
      return null;
    }

    if (
      payload['typ'] !== 'super-admin' &&
      payload['typ'] !== 'employee' &&
      payload['typ'] !== 'client'
    ) {
      return null;
    }

    return payload as AccessTokenPayload;
  } catch {
    return null;
  }
}

/**
 * Signs a short-lived (5-minute) token for the MFA challenge step.
 */
export async function signMfaChallengeToken(
  payload: Omit<MfaChallengePayload, 'iat' | 'exp'>,
): Promise<string> {
  const config = loadConfig();
  const secret = new TextEncoder().encode(config.JWT_ACCESS_SECRET);

  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer('tapcrm')
    .setAudience('tapcrm-mfa')
    .setIssuedAt()
    .setExpirationTime('300s') // 5 minutes
    .sign(secret);
}

/**
 * Verifies MFA challenge token.
 */
export async function verifyMfaChallengeToken(
  token: string,
): Promise<MfaChallengePayload | null> {
  try {
    const config = loadConfig();
    const secret = new TextEncoder().encode(config.JWT_ACCESS_SECRET);

    const { payload } = await jwtVerify(token, secret, {
      algorithms: ['HS256'],
      issuer: 'tapcrm',
      audience: 'tapcrm-mfa',
    });

    if (
      typeof payload.sub !== 'string' ||
      typeof payload['org'] !== 'string' ||
      typeof payload['typ'] !== 'string' ||
      typeof payload['ver'] !== 'number' ||
      typeof payload['requiresHighAssurance'] !== 'boolean'
    ) {
      return null;
    }

    return payload as MfaChallengePayload;
  } catch {
    return null;
  }
}

/**
 * Refresh token format:
 * organizationId.randomSecret
 */
export function generateRefreshToken(organizationId: string): {
  raw: string;
  hash: string;
} {
  const raw = `${organizationId}.${randomBytes(48).toString('base64url')}`;

  return {
    raw,
    hash: hashRefreshToken(raw),
  };
}

export function parseRefreshToken(raw: string): { organizationId: string } | null {
  const organizationId = raw.split('.', 1)[0] ?? '';

  const UUID =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  if (!UUID.test(organizationId)) {
    return null;
  }

  return {
    organizationId,
  };
}

export function hashRefreshToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}
