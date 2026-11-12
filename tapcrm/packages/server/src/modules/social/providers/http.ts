import { isIP } from 'node:net';
import { ProviderError, type OAuthCredential, type SocialContent } from './types.js';

export type Json = Record<string, unknown>;
export function object(value: unknown): Json {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Json)
    : {};
}
export function array(value: unknown): Json[] {
  return Array.isArray(value) ? value.map(object) : [];
}
export function string(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
export function number(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : Number(value) || 0;
}
/** A website a platform reports for a Page or company, as an absolute http(s) URL, or ''.
 * Facebook may list several space-separated sites and often omits the scheme. */
export function websiteUrl(value: unknown): string {
  const first = string(value).trim().split(/\s+/)[0] ?? '';
  if (!first || first.length > 2048) return '';
  try {
    const url = new URL(/^https?:\/\//i.test(first) ? first : `https://${first}`);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname.includes('.'))
      return '';
    return url.href;
  } catch {
    return '';
  }
}
export function requiredId(value: unknown): string {
  const id = string(value);
  if (!id)
    throw new ProviderError(
      'PROVIDER_RESPONSE_INVALID',
      'The platform did not return a resource ID. Review the destination before retrying.',
      { ambiguous: true },
    );
  return id;
}

export function assertRedirectUri(value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ProviderError(
      'INVALID_REDIRECT_URI',
      'Configure an absolute OAuth redirect URI.',
    );
  }
  if (
    (url.protocol !== 'https:' &&
      !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) ||
    url.username ||
    url.password ||
    url.hash
  ) {
    throw new ProviderError(
      'INVALID_REDIRECT_URI',
      'OAuth redirect URI must use HTTPS (localhost HTTP is permitted for development).',
    );
  }
}

export function isPublicHttps(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !isIP(url.hostname) &&
      !url.hostname.includes(':') &&
      url.hostname.includes('.') &&
      !['localhost', 'local', 'internal', 'test', 'invalid'].some(
        (suffix) => url.hostname === suffix || url.hostname.endsWith(`.${suffix}`),
      )
    );
  } catch {
    return false;
  }
}

export function validateCommon(content: SocialContent, maxCaption: number): string[] {
  const errors: string[] = [];
  if (content.caption.length > maxCaption)
    errors.push(`Caption must contain at most ${maxCaption} characters.`);
  if (!content.caption.trim() && content.media.length === 0 && !content.link)
    errors.push('Add a caption, link, or supported media.');
  if (content.link && !isPublicHttps(content.link))
    errors.push('Links must use a public HTTPS URL.');
  for (const media of content.media) {
    if (!isPublicHttps(media.url))
      errors.push('Media must have a public HTTPS URL accessible to the platform.');
  }
  return errors;
}

export function assertValid(errors: string[]): void {
  if (errors.length) throw new ProviderError('POST_INVALID', errors.join(' '));
}

/** A video upload outlasts an API call: ten minutes covers the largest file the CRM
 * accepts on a slow connection. */
export function uploadSignal(): AbortSignal {
  return AbortSignal.timeout(10 * 60_000);
}

/** The bytes CRM storage loaded for a media item; adapters never download a URL. */
export function mediaBytes(media: { bytes?: Uint8Array }): Uint8Array {
  if (!media.bytes?.length)
    throw new ProviderError(
      'MEDIA_BYTES_REQUIRED',
      'The media must be loaded from CRM storage before publishing.',
    );
  return media.bytes;
}

export function bearer(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}
export function form(values: Record<string, string>): URLSearchParams {
  return new URLSearchParams(values);
}
export function jsonBody(value: unknown): {
  headers: Record<string, string>;
  body: string;
} {
  return { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) };
}

/** Never emit raw response bodies: provider errors may repeat a token or a confidential URL. */
export async function request(
  url: string | URL,
  options: RequestInit = {},
  createsPost = false,
): Promise<{ data: Json; response: Response }> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...options,
      redirect: 'error',
      signal: options.signal ?? AbortSignal.timeout(30_000),
    });
  } catch {
    throw new ProviderError(
      'PLATFORM_UNREACHABLE',
      createsPost
        ? 'The platform response was interrupted. Publishing outcome is unknown; check the platform before retrying.'
        : 'The platform could not be reached. Try again later.',
      { transient: !createsPost, ambiguous: createsPost },
    );
  }
  let data: Json = {};
  try {
    const body = await response.text();
    if (body) data = object(JSON.parse(body));
  } catch {
    if (response.ok && response.status !== 204)
      throw new ProviderError(
        'PROVIDER_RESPONSE_INVALID',
        'The platform returned an unreadable response.',
        { ambiguous: createsPost },
      );
  }
  if (!response.ok) {
    const providerCode = object(data['error'])['code'];
    const revoked =
      response.status === 401 ||
      providerCode === 190 ||
      data['error'] === 'invalid_grant';
    const rateLimited =
      response.status === 429 ||
      providerCode === 4 ||
      providerCode === 17 ||
      providerCode === 32 ||
      providerCode === 613;
    const retryHeader = response.headers.get('retry-after');
    const retryAfter = retryHeader
      ? Math.max(
          1,
          Math.min(
            86_400,
            Number(retryHeader) ||
              Math.ceil((Date.parse(retryHeader) - Date.now()) / 1000) ||
              60,
          ),
        )
      : 60;
    const ambiguous = createsPost && response.status >= 500;
    throw new ProviderError(
      revoked
        ? 'CONNECTION_REVOKED'
        : rateLimited
          ? 'PLATFORM_RATE_LIMITED'
          : response.status === 403
            ? 'PLATFORM_PERMISSION_DENIED'
            : 'PLATFORM_REQUEST_FAILED',
      revoked
        ? 'Authorization expired or was revoked. Reconnect this account.'
        : rateLimited
          ? 'The platform rate limit was reached. Publishing will resume after the retry delay.'
          : response.status === 403
            ? 'The platform denied access. Check app approval, account role, and granted permissions.'
            : ambiguous
              ? 'The platform returned an error after accepting the request. Check for an existing post before retrying.'
              : 'The platform rejected the request. Check the content and account permissions.',
      {
        status: response.status,
        reconnectRequired: revoked,
        transient: rateLimited || (response.status >= 500 && !createsPost),
        ambiguous,
        ...(rateLimited ? { retryAfter } : {}),
      },
    );
  }
  return { data, response };
}

export function tokenFromResponse(
  data: Json,
  fallbackScopes: string[],
  existing?: OAuthCredential,
): OAuthCredential {
  const accessToken = string(data['access_token']);
  if (!accessToken)
    throw new ProviderError(
      'OAUTH_TOKEN_MISSING',
      'The platform did not return an access token. Reconnect this account.',
    );
  const refreshToken = string(data['refresh_token']) || existing?.refreshToken;
  const expiresIn = number(data['expires_in']);
  const scope = string(data['scope']);
  return {
    accessToken,
    scopes: scope ? scope.split(/[ ,]+/).filter(Boolean) : fallbackScopes,
    ...(refreshToken ? { refreshToken } : {}),
    ...(expiresIn > 0
      ? { expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString() }
      : {}),
    ...(existing?.metadata ? { metadata: existing.metadata } : {}),
  };
}

export function unsupported(message: string): never {
  throw new ProviderError('CAPABILITY_UNAVAILABLE', message);
}

/** Only follow upload URLs returned by a provider and belonging to that provider. */
export function assertUploadUrl(value: string, allowedSuffixes: string[]): void {
  if (!isPublicHttps(value))
    throw new ProviderError(
      'UPLOAD_URL_INVALID',
      'The platform returned an invalid upload URL.',
    );
  const host = new URL(value).hostname;
  if (!allowedSuffixes.some((suffix) => host === suffix || host.endsWith(`.${suffix}`)))
    throw new ProviderError(
      'UPLOAD_URL_INVALID',
      'The platform returned an unexpected upload host.',
    );
}
