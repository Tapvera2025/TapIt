import { lookup } from 'dns/promises';

/**
 * SSRF guard: validates a URL is safe to fetch before any outbound request.
 * Rejects private, link-local, loopback, metadata service, and disallowed scheme targets.
 * Must be called AFTER every redirect, not only on the initial URL.
 *
 * See OWASP SSRF prevention: https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html
 */

const BLOCKED_RANGES: Array<(ip: string) => boolean> = [
  // Loopback
  (ip) => ip === '127.0.0.1' || ip === '::1' || ip.startsWith('127.'),
  // Private Class A
  (ip) => ip.startsWith('10.'),
  // Private Class B
  (ip) => /^172\.(1[6-9]|2\d|3[01])\./.test(ip),
  // Private Class C
  (ip) => ip.startsWith('192.168.'),
  // Link-local
  (ip) => ip.startsWith('169.254.') || ip.startsWith('fe80:'),
  // Multicast
  (ip) => ip.startsWith('224.') || ip.startsWith('225.') || ip.startsWith('239.'),
  // AWS/GCP/Azure metadata services
  (ip) => ip === '169.254.169.254' || ip === 'fd00:ec2::254',
  // Cloud Run metadata
  (ip) => ip === 'metadata.google.internal',
];

const ALLOWED_SCHEMES = new Set(['http:', 'https:']);
const ALLOWED_PORTS = new Set([80, 443, 8080, 8443]);

export class SsrfBlockedError extends Error {
  constructor(reason: string) {
    super(`SSRF guard blocked request: ${reason}`);
  }
}

/**
 * The host does not resolve. Still a guard refusal (nothing was sent), but the
 * crawler reports it as "address not found" rather than as a safety block.
 */
export class HostNotFoundError extends SsrfBlockedError {
  readonly hostname: string;
  constructor(hostname: string) {
    super(`DNS resolution failed for "${hostname}"`);
    this.hostname = hostname;
  }
}

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
  for (const blocked of BLOCKED_RANGES) {
    if (blocked(ip)) {
      throw new SsrfBlockedError(`IP ${ip} is in a blocked network range`);
    }
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
  const response = await fetch(url, { ...init, redirect: 'manual' });
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get('location');
    if (!location) throw new SsrfBlockedError('redirect without Location header');
    await guardUrl(new URL(location, url).toString());
    return safeFetch(new URL(location, url).toString(), init);
  }
  return response;
}
