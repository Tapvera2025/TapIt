import { SignJWT, importPKCS8 } from 'jose';
import { loadConfig } from '../../../config.js';

/**
 * Access tokens for Google APIs, in either of the two modes `config.ts`
 * documents. Both end at the same endpoint with a different grant, so the
 * difference is ten lines rather than two integrations.
 *
 * DP-3 — nothing here holds a default for a secret; it reads what the platform
 * injected and fails loudly when a mode's fields are absent (`loadConfig`
 * already refuses to boot in that state).
 */

/** Google's token endpoint; only a test or staging stand-in changes it (GOOGLE_TOKEN_URL). */
function tokenEndpoint(): string {
  return loadConfig().GOOGLE_TOKEN_URL;
}
const JWT_BEARER_GRANT = 'urn:ietf:params:oauth:grant-type:jwt-bearer';

/** Read-only is all the rank provider needs, and all it should be able to do. */
export const SEARCH_CONSOLE_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';

/** A service-account assertion is short-lived by design; Google allows up to an hour. */
const ASSERTION_TTL_SECONDS = 3600;
/** Renew this far before expiry, so a token never expires mid-request. */
const RENEW_MARGIN_MS = 60_000;

export class GoogleAuthUnavailableError extends Error {}

interface TokenResponse {
  readonly access_token?: string;
  readonly expires_in?: number;
  readonly error?: string;
  readonly error_description?: string;
}

interface CachedToken {
  readonly token: string;
  readonly expiresAt: number;
}

/** Keyed by scope: a second scope must not be served the first one's token. */
const cache = new Map<string, CachedToken>();

/**
 * A key written into an environment variable has its newlines escaped, and
 * `importPKCS8` rejects the escaped form with an opaque error.
 */
function normalisePrivateKey(pem: string): string {
  return pem.includes('\\n') ? pem.replace(/\\n/g, '\n') : pem;
}

async function requestToken(body: Record<string, string>): Promise<CachedToken> {
  let response: Response;
  try {
    response = await fetch(tokenEndpoint(), {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body).toString(),
    });
  } catch (cause) {
    // Network failure: retryable, and the job runner's backoff is the right
    // place to decide that, so it surfaces as an ordinary error.
    throw new Error(`Google token endpoint unreachable: ${cause instanceof Error ? cause.message : String(cause)}`);
  }

  const payload = (await response.json().catch(() => ({}))) as TokenResponse;
  if (!response.ok || payload.access_token === undefined) {
    const detail = payload.error_description ?? payload.error ?? `HTTP ${response.status}`;
    // A rejected grant is a configuration fault, not a transient one: retrying
    // an expired refresh token or a revoked key never succeeds.
    throw new GoogleAuthUnavailableError(`Google refused the credentials: ${detail}`);
  }
  const lifetime = (payload.expires_in ?? ASSERTION_TTL_SECONDS) * 1000;
  return { token: payload.access_token, expiresAt: Date.now() + lifetime };
}

async function mintServiceAccountToken(scope: string, subject?: string): Promise<CachedToken> {
  const config = loadConfig();
  const email = config.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const pem = config.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
  if (email === undefined || pem === undefined) {
    throw new GoogleAuthUnavailableError('Service-account credentials are not configured');
  }

  let key: Awaited<ReturnType<typeof importPKCS8>>;
  try {
    key = await importPKCS8(normalisePrivateKey(pem), 'RS256');
  } catch (cause) {
    throw new GoogleAuthUnavailableError(
      `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY is not a usable PKCS#8 key: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }

  const jwt = new SignJWT({ scope })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer(email)
    .setAudience(tokenEndpoint())
    .setIssuedAt()
    .setExpirationTime(`${ASSERTION_TTL_SECONDS}s`);
  // Domain-wide delegation: act as this Workspace user.
  if (subject !== undefined) jwt.setSubject(subject);
  const assertion = await jwt.sign(key);

  return requestToken({ grant_type: JWT_BEARER_GRANT, assertion });
}

async function mintOauthToken(): Promise<CachedToken> {
  const config = loadConfig();
  const clientId = config.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = config.GOOGLE_OAUTH_CLIENT_SECRET;
  const refreshToken = config.GOOGLE_OAUTH_REFRESH_TOKEN;
  if (clientId === undefined || clientSecret === undefined || refreshToken === undefined) {
    throw new GoogleAuthUnavailableError('OAuth credentials are not configured');
  }
  // The refresh-token grant returns a token for whatever scopes the refresh
  // token was granted; `scope` is not a parameter here.
  return requestToken({
    grant_type: 'refresh_token',
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
  });
}

/** True when a provider can be used at all. Callers check before reaching out. */
export function googleAuthConfigured(): boolean {
  return loadConfig().GOOGLE_SEARCH_CONSOLE_AUTH !== 'off';
}

/**
 * A usable access token for `scope`, cached until shortly before it expires.
 * Concurrent callers may both mint one on a cold cache; that is cheaper than
 * holding a lock, and Google issues tokens freely.
 */
export async function googleAccessToken(scope: string = SEARCH_CONSOLE_SCOPE): Promise<string> {
  const mode = loadConfig().GOOGLE_SEARCH_CONSOLE_AUTH;
  if (mode === 'off') {
    throw new GoogleAuthUnavailableError('Google Search Console access is turned off (GOOGLE_SEARCH_CONSOLE_AUTH=off)');
  }

  const cached = cache.get(scope);
  if (cached !== undefined && cached.expiresAt - RENEW_MARGIN_MS > Date.now()) return cached.token;

  const minted = mode === 'service-account' ? await mintServiceAccountToken(scope) : await mintOauthToken();
  cache.set(scope, minted);
  return minted.token;
}

/** Tests, and an operator forcing a re-mint after rotating a credential. */
export function __clearGoogleTokenCache(): void {
  cache.clear();
}

/* ------------------------------------------------------------------ *
 * Calendar access for client meetings (MEETINGS_GOOGLE_AUTH).
 * ------------------------------------------------------------------ */

/**
 * Workspace domain-wide delegation: a token that acts as `subject` (their
 * Workspace email). The admin must have authorized the service account's
 * client id for exactly these scopes.
 */
export async function googleDelegatedAccessToken(
  scopes: readonly string[],
  subject: string,
): Promise<string> {
  const scope = [...scopes].sort().join(' ');
  const key = `delegated ${subject.toLowerCase()} ${scope}`;
  const cached = cache.get(key);
  if (cached !== undefined && cached.expiresAt - RENEW_MARGIN_MS > Date.now()) return cached.token;
  const minted = await mintServiceAccountToken(scope, subject);
  cache.set(key, minted);
  return minted.token;
}

function oauthClient(): { clientId: string; clientSecret: string } {
  const config = loadConfig();
  if (config.GOOGLE_OAUTH_CLIENT_ID === undefined || config.GOOGLE_OAUTH_CLIENT_SECRET === undefined) {
    throw new GoogleAuthUnavailableError('GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET are not configured');
  }
  return { clientId: config.GOOGLE_OAUTH_CLIENT_ID, clientSecret: config.GOOGLE_OAUTH_CLIENT_SECRET };
}

/**
 * A fresh access token from one person's stored refresh token. Throws
 * GoogleAuthUnavailableError when Google refuses it (revoked, expired), which
 * means that person has to connect again.
 */
export async function googleRefreshedAccessToken(refreshToken: string): Promise<{ token: string; expiresAt: number }> {
  const { clientId, clientSecret } = oauthClient();
  return requestToken({
    grant_type: 'refresh_token',
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
  });
}

export interface GoogleCodeExchange {
  readonly accessToken: string;
  readonly refreshToken: string | null;
  readonly idToken: string | null;
  readonly scope: string;
  readonly expiresInSeconds: number;
}

/** Trades the code from Google's consent screen for tokens. */
export async function exchangeGoogleAuthorizationCode(code: string, redirectUri: string): Promise<GoogleCodeExchange> {
  const { clientId, clientSecret } = oauthClient();
  let response: Response;
  try {
    response = await fetch(tokenEndpoint(), {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        client_secret: clientSecret,
      }).toString(),
    });
  } catch (cause) {
    throw new Error(`Google token endpoint unreachable: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
  const payload = (await response.json().catch(() => ({}))) as TokenResponse & {
    readonly refresh_token?: string;
    readonly id_token?: string;
    readonly scope?: string;
  };
  if (!response.ok || payload.access_token === undefined) {
    throw new GoogleAuthUnavailableError(`Google refused the sign-in: ${payload.error_description ?? payload.error ?? `HTTP ${response.status}`}`);
  }
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token ?? null,
    idToken: payload.id_token ?? null,
    scope: payload.scope ?? '',
    expiresInSeconds: payload.expires_in ?? 3600,
  };
}

/** Best effort: tells Google to forget a token when someone disconnects. */
export async function revokeGoogleToken(token: string): Promise<void> {
  try {
    await fetch(new URL('/revoke', tokenEndpoint()), {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }).toString(),
    });
  } catch {
    // Disconnecting still deletes the stored token; Google expires unused ones.
  }
}
