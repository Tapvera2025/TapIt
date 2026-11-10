import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import http, { type IncomingMessage } from 'node:http';
import https from 'node:https';
import { BlockList, isIP } from 'node:net';
import type { Readable } from 'node:stream';
import zlib from 'node:zlib';

/**
 * An outbound GET for link previews that cannot be pointed at our own network.
 *
 * Link previews fetch whatever URL a person pastes, so without care they are
 * a Server-Side Request Forgery: "http://169.254.169.254/latest/meta-data"
 * (cloud credentials), "http://localhost:6379", "http://10.0.0.5/admin".
 *
 *   - http/https only, default ports only, no credentials in the URL;
 *   - the host is resolved HERE and every address it resolves to must be
 *     public — and the socket connects to exactly the address we checked
 *     (custom `lookup`), so a DNS answer cannot change between the check and
 *     the connection (DNS rebinding);
 *   - IP-literal hosts are checked the same way;
 *   - redirects are followed by hand, each hop re-checked, at most four;
 *   - a hard overall timeout, and a byte cap applied AFTER decompression
 *     (a small gzip can inflate to gigabytes).
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

/** Whether `address` is a public unicast address a preview may fetch from. */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !BLOCKED.check(address, 'ipv4');
  if (family === 6) {
    const lower = address.toLowerCase();
    // IPv4-mapped (::ffff:a.b.c.d / ::ffff:hhhh:hhhh) is judged by the IPv4 inside it.
    const mapped = /^(?:0{0,4}:){0,5}:?ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
    if (mapped?.[1]) return isPublicAddress(mapped[1]);
    const mappedHex = /^(?:0{0,4}:){0,5}:?ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(lower);
    if (mappedHex?.[1] && mappedHex[2]) {
      const high = parseInt(mappedHex[1], 16);
      const low = parseInt(mappedHex[2], 16);
      return isPublicAddress(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
    }
    return !BLOCKED.check(lower, 'ipv6');
  }
  return false;
}

export class BlockedUrlError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'BlockedUrlError';
  }
}

export interface SafeFetchOptions {
  /** Total time for the whole fetch, redirects included. */
  readonly timeoutMs: number;
  /** Bytes of (decompressed) body to keep. */
  readonly maxBytes: number;
  /** Development/testing only (CHAT_LINK_PREVIEW_ALLOW_PRIVATE_NETWORKS). */
  readonly allowPrivateNetworks?: boolean;
  readonly accept?: string;
  /** Stop reading early once this returns true for the bytes so far (e.g. `</head>` seen). */
  readonly enough?: (soFar: Buffer) => boolean;
  readonly maxRedirects?: number;
}

export interface SafeFetchResult {
  readonly finalUrl: string;
  readonly status: number;
  readonly contentType: string;
  readonly body: Buffer;
}

const USER_AGENT = 'Mozilla/5.0 (compatible; TapCRM-LinkPreview/1.0; +https://tapvera.io)';

export function assertFetchableUrl(raw: string, allowPrivateNetworks = false): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new BlockedUrlError('not a URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new BlockedUrlError('only http and https are fetched');
  if (url.username || url.password) throw new BlockedUrlError('URLs with credentials are not fetched');
  if (!allowPrivateNetworks && url.port !== '' && url.port !== '80' && url.port !== '443') {
    throw new BlockedUrlError('only the default web ports are fetched');
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host) && !allowPrivateNetworks && !isPublicAddress(host)) throw new BlockedUrlError('private address');
  return url;
}

type LookupCallback = (error: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;

function guardedLookup(allowPrivateNetworks: boolean) {
  return (hostname: string, options: { all?: boolean } | number | undefined, callback: LookupCallback): void => {
    dnsLookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
      if (error) {
        callback(error, '', 0);
        return;
      }
      const usable = allowPrivateNetworks ? addresses : addresses.filter((entry) => isPublicAddress(entry.address));
      // Any private answer poisons the whole name: a host that resolves to both a
      // public and a private address is exactly how rebinding attacks are staged.
      if (usable.length === 0 || usable.length !== addresses.length) {
        const blocked = Object.assign(new Error(`refusing to connect to a private address for ${hostname}`), { code: 'EBLOCKED' });
        callback(blocked, '', 0);
        return;
      }
      if (typeof options === 'object' && options?.all) {
        callback(null, usable);
        return;
      }
      const first = usable[0]!;
      callback(null, first.address, first.family);
    });
  };
}

function requestOnce(url: URL, options: SafeFetchOptions, signal: AbortSignal): Promise<IncomingMessage> {
  const transport = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const request = transport.request(
      url,
      {
        method: 'GET',
        signal,
        lookup: guardedLookup(options.allowPrivateNetworks === true) as unknown as typeof dnsLookup,
        headers: {
          'user-agent': USER_AGENT,
          accept: options.accept ?? 'text/html,application/xhtml+xml;q=0.9,image/*;q=0.8,*/*;q=0.5',
          'accept-language': 'en-IN,en;q=0.9',
          'accept-encoding': 'gzip, deflate, br',
        },
        // Fresh connection per hop: a pooled socket could be reused for a different host.
        agent: false,
      },
      resolve,
    );
    request.on('error', reject);
    request.end();
  });
}

function decode(response: IncomingMessage): Readable {
  const encoding = String(response.headers['content-encoding'] ?? '').toLowerCase();
  if (encoding === 'gzip' || encoding === 'x-gzip') return response.pipe(zlib.createGunzip());
  if (encoding === 'deflate') return response.pipe(zlib.createInflate());
  if (encoding === 'br') return response.pipe(zlib.createBrotliDecompress());
  return response;
}

async function readCapped(response: IncomingMessage, options: SafeFetchOptions): Promise<Buffer> {
  const stream = decode(response);
  // Stopping early destroys both ends; errors after that point are expected noise.
  const ignore = (): void => undefined;
  stream.on('error', ignore);
  response.on('error', ignore);
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for await (const chunk of stream) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
      const room = options.maxBytes - total;
      chunks.push(room < buffer.length ? buffer.subarray(0, room) : buffer);
      total += Math.min(room, buffer.length);
      if (total >= options.maxBytes) break;
      if (options.enough && options.enough(Buffer.concat(chunks))) break;
    }
  } finally {
    stream.destroy();
    response.destroy();
  }
  return Buffer.concat(chunks);
}

export async function safeFetch(rawUrl: string, options: SafeFetchOptions): Promise<SafeFetchResult> {
  const signal = AbortSignal.timeout(options.timeoutMs);
  let url = assertFetchableUrl(rawUrl, options.allowPrivateNetworks === true);
  const maxRedirects = options.maxRedirects ?? 4;
  for (let hop = 0; ; hop += 1) {
    const response = await requestOnce(url, options, signal);
    const status = response.statusCode ?? 0;
    if (status >= 300 && status < 400 && response.headers.location) {
      response.resume();
      if (hop >= maxRedirects) throw new BlockedUrlError('too many redirects');
      url = assertFetchableUrl(new URL(response.headers.location, url).toString(), options.allowPrivateNetworks === true);
      continue;
    }
    const contentType = String(response.headers['content-type'] ?? '').toLowerCase();
    if (status < 200 || status >= 300) {
      response.resume();
      return { finalUrl: url.toString(), status, contentType, body: Buffer.alloc(0) };
    }
    const body = await readCapped(response, options);
    return { finalUrl: url.toString(), status, contentType, body };
  }
}
