import { existsSync } from 'node:fs';
import { isIP } from 'node:net';

/**
 * Whether a request was made on the developer's own machine. Used only by the
 * development instant password reset (DEV_INSTANT_PASSWORD_RESET).
 *
 * - The TCP peer must be this machine. When the API runs in a container (the
 *   Docker Compose stack), the browser's requests arrive from the Docker
 *   network instead, so a private address is accepted there; this
 *   repository's compose file publishes the API and web ports on 127.0.0.1 only.
 * - A browser page must have been opened as localhost (its Origin). The Vite
 *   dev server forwards every page's requests from this machine, so this is
 *   what catches a dev server opened from another device (VITE_HOST).
 * - A proxy that names the real client (X-Forwarded-For) must name this machine.
 *
 * `req.ip` is not used: with `trust proxy` on, a client can choose it.
 */
export interface RequestOrigin {
  readonly remoteAddress: string | undefined;
  readonly forwardedFor: string | readonly string[] | undefined;
  readonly origin: string | undefined;
}

/** "::ffff:127.0.0.1" → "127.0.0.1". */
function unmapped(address: string): string {
  const tail = address.slice(7);
  return address.toLowerCase().startsWith('::ffff:') && isIP(tail) === 4 ? tail : address;
}

function isLoopbackAddress(address: string): boolean {
  const value = unmapped(address.trim());
  return isIP(value) === 4 ? value.startsWith('127.') : value === '::1';
}

/** Private network ranges a container network uses (not CGNAT, which VPNs such as Tailscale use). */
function isPrivateAddress(address: string): boolean {
  const value = unmapped(address.trim());
  if (isIP(value) === 4) {
    const [first = 0, second = 0] = value.split('.').map(Number);
    return first === 10 || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168);
  }
  return isIP(value) === 6 && /^f[cd][0-9a-f]{2}:/i.test(value);
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === 'localhost'
    || hostname.endsWith('.localhost')
    || hostname === '[::1]'
    || (isIP(hostname) === 4 && hostname.startsWith('127.'));
}

export function isLocalRequest(request: RequestOrigin, insideContainer: boolean): boolean {
  const peer = request.remoteAddress ?? '';
  if (!isLoopbackAddress(peer) && !(insideContainer && isPrivateAddress(peer))) return false;

  const forwarded = typeof request.forwardedFor === 'string' ? [request.forwardedFor] : request.forwardedFor ?? [];
  const hops = forwarded.join(',').split(',').map((hop) => hop.trim()).filter(Boolean);
  if (hops.some((hop) => !isLoopbackAddress(hop))) return false;

  if (!request.origin) return true;
  try {
    return isLoopbackHost(new URL(request.origin).hostname);
  } catch {
    return false; // "null" and other opaque origins
  }
}

let insideContainer: boolean | undefined;

/** Docker and Podman mark their containers with these files. */
export function runningInContainer(): boolean {
  insideContainer ??= existsSync('/.dockerenv') || existsSync('/run/.containerenv');
  return insideContainer;
}
