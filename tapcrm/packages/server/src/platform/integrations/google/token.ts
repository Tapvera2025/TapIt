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

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
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
    response = await fetch(TOKEN_ENDPOINT, {
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

async function mintServiceAccountToken(scope: string): Promise<CachedToken> {
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

  const assertion = await new SignJWT({ scope })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer(email)
    .setAudience(TOKEN_ENDPOINT)
    .setIssuedAt()
    .setExpirationTime(`${ASSERTION_TTL_SECONDS}s`)
    .sign(key);

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
