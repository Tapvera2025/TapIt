import { lookup } from 'dns/promises';
import { isPublicAddress } from '../../../platform/security/public-address.js';
import { guardedFetch } from './guarded-fetch.js';
import { HostNotFoundError, SsrfBlockedError } from './ssrf-errors.js';

export { HostNotFoundError, SsrfBlockedError };

/**
 * SSRF guard: validates a URL is safe to fetch before any outbound request.
 * Rejects private, link-local, loopback, metadata service, and disallowed scheme targets.
 * Must be called AFTER every redirect, not only on the initial URL.
 *
 * See OWASP SSRF prevention: https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html
 */


const ALLOWED_SCHEMES = new Set(['http:', 'https:']);
const ALLOWED_PORTS = new Set([80, 443, 8080, 8443]);



export function validateScheme(url: URL): void {
  if (!ALLOWED_SCHEMES.has(url.protocol)) {
    throw new SsrfBlockedError(`scheme "${url.protocol}" is not permitted`);
  }
  // Reject URL userinfo (credentials in URL)
  if (url.username || url.password) {
    throw new SsrfBlockedError('URL userinfo is not permitted');
  }
}

export function validatePort(url: URL): void {
  const port = url.port ? parseInt(url.port, 10) : (url.protocol === 'https:' ? 443 : 80);
  if (!ALLOWED_PORTS.has(port)) {
    throw new SsrfBlockedError(`port ${port} is not on the allowed list`);
  }
}

export function validateIp(ip: string): void {
  if (!isPublicAddress(ip)) {
    throw new SsrfBlockedError(`IP ${ip} is not a public address`);
  }
}

/** Full URL validation including DNS resolution. Always await this before fetching. */
export async function guardUrl(rawUrl: string): Promise<void> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SsrfBlockedError(`malformed URL: ${rawUrl}`);
  }

  validateScheme(url);
  validatePort(url);

  // Block direct IP targets in private ranges without DNS
  if (/^[\d.]+$/.test(url.hostname) || url.hostname.includes(':')) {
    validateIp(url.hostname);
    return;
  }

  // Block known metadata hostnames before DNS resolution
  const lowerHost = url.hostname.toLowerCase();
  if (
    lowerHost === 'metadata.google.internal' ||
    lowerHost === 'instance-data' ||
    lowerHost.endsWith('.internal') ||
    lowerHost.endsWith('.local')
  ) {
    throw new SsrfBlockedError(`hostname "${url.hostname}" is not permitted`);
  }

  // Resolve DNS and validate all returned IPs (DNS rebinding protection)
  let addresses: string[];
  try {
    const result = await lookup(url.hostname, { all: true });
    addresses = result.map((r) => r.address);
  } catch {
    throw new HostNotFoundError(url.hostname);
  }

  if (addresses.length === 0) {
    throw new SsrfBlockedError(`no DNS records for "${url.hostname}"`);
  }

  for (const ip of addresses) {
    validateIp(ip);
  }
}

/** Safe fetch wrapper: validates URL before sending any bytes. */
export async function safeFetch(url: string, init?: RequestInit): Promise<Response> {
  await guardUrl(url);
  // After redirect, the SSRF guard must re-validate the new URL.
  // We use manual redirect mode and validate each hop.
  const response = await guardedFetch(url, {
    ...(init?.method !== undefined ? { method: init.method } : {}),
    ...(init?.headers !== undefined ? { headers: new Headers(init.headers) } : {}),
    ...(typeof init?.body === 'string' ? { body: init.body } : {}),
    ...(init?.signal ? { signal: init.signal } : {}),
    redirect: 'manual',
  });
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get('location');
    if (!location) throw new SsrfBlockedError('redirect without Location header');
    await guardUrl(new URL(location, url).toString());
    return safeFetch(new URL(location, url).toString(), init);
  }
  return response;
}
