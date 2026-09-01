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

/* ==================================================================== *
 * Tenant-scoped opaque tokens
 * ==================================================================== */

/**
 * Every opaque credential in the product carries its organization.
 *
 *   <organizationId>.<random secret>
 *
 * This is not decoration. `refresh_token`, `password_reset_token`,
 * `email_verification_token` and `employee_invitation` are all tenant-owned
 * tables with RLS forced, so looking one up requires knowing the tenant BEFORE
 * the row can be read. A bare random token has no tenant, which leaves exactly
 * two options: query without tenant context — where the policy matches nothing
 * and the lookup silently always fails — or scan every organization, which is a
 * cross-tenant read (MT-5). The first is what the identity module was doing.
 *
 * Putting the organization in the token removes the dilemma. The prefix is not
 * a secret and grants nothing on its own; the entropy is entirely in the
 * 48-byte random half, and only the SHA-256 of the whole string is stored.
 */

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface ScopedToken {
  /** Shown to the holder once. Never stored. */
  readonly raw: string;
  /** What goes in the database. */
  readonly hash: string;
}

export function mintScopedToken(organizationId: string): ScopedToken {
  const raw = `${organizationId}.${randomBytes(48).toString('base64url')}`;
  return { raw, hash: hashToken(raw) };
}

/**
 * Recovers the organization from a presented token.
 *
 * Returns null for anything malformed, so a caller cannot pass a non-UUID into
 * `set_config('app.organization_id', …)`.
 */
export function parseScopedToken(raw: string): { organizationId: string } | null {
  const organizationId = raw.split('.', 1)[0] ?? '';
  return UUID_PATTERN.test(organizationId) ? { organizationId } : null;
}

/**
 * Tokens are stored hashed, so a database read cannot yield a usable
 * credential. SHA-256 rather than Argon2 deliberately: these are 384-bit random
 * values, not passwords, so there is no dictionary to slow an attacker down and
 * the lookup has to be a single indexed equality.
 */
export function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

/*
 * Refresh tokens are scoped tokens. The aliases keep the ID-6 rotation code
 * reading in its own vocabulary without creating a second implementation.
 */
export const generateRefreshToken = mintScopedToken;
export const parseRefreshToken = parseScopedToken;
export const hashRefreshToken = hashToken;
