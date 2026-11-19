import { BlockList, isIP } from 'node:net';
import type { Request } from 'express';

/**
 * Where a machine push really came from, and whether that address may push.
 *
 * The app trusts one proxy hop (`trust proxy 1`), so `req.ip` is whatever the
 * caller put in X-Forwarded-For when nothing sits in front of the API. For
 * attendance that let anyone who reached the API directly claim an allowlisted
 * address. Here a forwarded address is believed only when the TCP peer is a
 * local proxy (the biometric gateway or another container on this host);
 * a public peer is judged by its own address.
 */

const LOCAL = new BlockList();
for (const [network, prefix] of [
  ['10.0.0.0', 8], ['172.16.0.0', 12], ['192.168.0.0', 16], ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  // Carrier-grade NAT range, used by office VPNs such as Tailscale.
  ['100.64.0.0', 10],
] as const) LOCAL.addSubnet(network, prefix, 'ipv4');
for (const [network, prefix] of [['::1', 128], ['fc00::', 7], ['fe80::', 10]] as const) {
  LOCAL.addSubnet(network, prefix, 'ipv6');
}

/** "::ffff:192.168.1.5" → "192.168.1.5"; blanks and junk → "". */
export function normaliseIp(ip: string | undefined | null): string {
  const value = (ip ?? '').trim();
  const unmapped = value.toLowerCase().startsWith('::ffff:') && isIP(value.slice(7)) === 4 ? value.slice(7) : value;
  return isIP(unmapped) ? unmapped : '';
}

/** A private, loopback or link-local address: the office network or this host. */
export function isLocalAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 0) return false;
  return LOCAL.check(ip, family === 4 ? 'ipv4' : 'ipv6');
}

/** The machine's address: the peer itself, or what a local proxy in front of us reported. */
export function machineSourceAddress(req: Pick<Request, 'socket' | 'header'>): string {
  const peer = normaliseIp(req.socket.remoteAddress);
  if (!isLocalAddress(peer)) return peer;
  const forwarded = req.header('x-forwarded-for');
  if (!forwarded) return peer;
  // The proxy directly in front of us appends (or, the biometric gateway,
  // writes) the address it saw as the LAST entry; earlier ones are claims.
  const hops = forwarded.split(',').map((hop) => hop.trim()).filter(Boolean);
  return normaliseIp(hops[hops.length - 1]) || peer;
}

/**
 * Whether a device may push from `source`. With an allowlist (addresses or
 * ranges such as 192.168.1.0/24), only those. Without one, only the office
 * network: a machine's serial number is printed on it, so it cannot be the
 * only thing standing between the internet and the attendance ledger.
 */
export function sourceAllowed(allowlist: readonly string[], source: string): boolean {
  const family = isIP(source);
  if (family === 0) return false;
  if (allowlist.length === 0) return isLocalAddress(source);
  const allowed = new BlockList();
  for (const entry of allowlist) {
    const [ip = '', bits] = entry.split('/');
    const entryFamily = isIP(ip);
    if (entryFamily === 0) continue;
    const type = entryFamily === 4 ? 'ipv4' : 'ipv6';
    if (bits === undefined) allowed.addAddress(ip, type);
    else allowed.addSubnet(ip, Number(bits), type);
  }
  return allowed.check(source, family === 4 ? 'ipv4' : 'ipv6');
}
