import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { BlockList, isIP } from 'node:net';

/**
 * Outbound requests to addresses a user typed (SEO crawls, link previews) must
 * reach only the public internet, never this server, its containers or the
 * office network. These are the non-public ranges (RFC 6890 and friends).
 */
const BLOCKED = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) {
  BLOCKED.addSubnet(network, prefix, 'ipv4');
}
for (const [network, prefix] of [
  ['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8],
  ['2001:db8::', 32], ['100::', 64], ['64:ff9b::', 96], ['64:ff9b:1::', 48], ['2002::', 16], ['2001::', 32],
] as const) {
  BLOCKED.addSubnet(network, prefix, 'ipv6');
}

/** True only for a routable public address. Brackets and IPv4-mapped IPv6 are handled. */
export function isPublicAddress(raw: string): boolean {
  const address = raw.trim().replace(/^\[|\]$/g, '');
  const family = isIP(address);
  if (family === 4) return !BLOCKED.check(address, 'ipv4');
  if (family === 6) {
    const lower = address.toLowerCase();
    // IPv4-mapped (::ffff:a.b.c.d / ::ffff:hhhh:hhhh) is judged by the IPv4 inside it.
    const dotted = /^(?:0{0,4}:){0,5}:?ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
    if (dotted?.[1]) return isPublicAddress(dotted[1]);
    const hex = /^(?:0{0,4}:){0,5}:?ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(lower);
    if (hex?.[1] && hex[2]) {
      const high = Number.parseInt(hex[1], 16);
      const low = Number.parseInt(hex[2], 16);
      return isPublicAddress(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
    }
    return !BLOCKED.check(address, 'ipv6');
  }
  return false;
}

export class PrivateAddressError extends Error {
  readonly code = 'EBLOCKED';
  constructor(hostname: string) {
    super(`refusing to connect to a non-public address for ${hostname}`);
    this.name = 'PrivateAddressError';
  }
}

type LookupCallback = (error: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;

/**
 * A `lookup` for http/https/net that resolves the name ONCE and connects to
 * exactly the addresses it checked. Checking a name and then letting the
 * connection resolve it again lets a DNS answer change in between (rebinding).
 * Any non-public answer refuses the whole name.
 */
export function publicOnlyLookup(
  hostname: string,
  options: { all?: boolean } | number | undefined,
  callback: LookupCallback,
): void {
  dnsLookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
    if (error) {
      callback(error, '', 0);
      return;
    }
    if (addresses.length === 0 || addresses.some((entry) => !isPublicAddress(entry.address))) {
      callback(new PrivateAddressError(hostname), '', 0);
      return;
    }
    if (typeof options === 'object' && options?.all) {
      callback(null, addresses);
      return;
    }
    const first = addresses[0]!;
    callback(null, first.address, first.family);
  });
}
