import type { lookup as dnsLookup } from 'node:dns';
import http, { type IncomingMessage } from 'node:http';
import https from 'node:https';
import { Readable } from 'node:stream';
import zlib from 'node:zlib';
import { isIP } from 'node:net';
import { isPublicAddress, PrivateAddressError, publicOnlyLookup } from '../../../platform/security/public-address.js';
import { SsrfBlockedError } from './ssrf-errors.js';

/**
 * `fetch`, for addresses users typed, that can only connect to the public
 * internet. The global fetch resolves a host name again after guardUrl checked
 * it, so a DNS answer that changes in between (rebinding) could still reach
 * this server or the office network. This one resolves once, refuses any
 * non-public answer, and connects to exactly that address.
 *
 * It never follows redirects: callers validate each hop (guardUrl) and request
 * it themselves, as with `redirect: 'manual'`. Returns a standard Response.
 */

export interface GuardedRequestInit {
  readonly method?: string;
  readonly headers?: Record<string, string> | Headers;
  readonly body?: string | Uint8Array | null;
  readonly signal?: AbortSignal | null;
  /** 'manual' (default) returns a redirect as-is; 'error' throws on one. */
  readonly redirect?: 'manual' | 'error' | 'follow';
}

const NULL_BODY_STATUSES = new Set([101, 204, 205, 304]);

function headerRecord(headers: GuardedRequestInit['headers']): Record<string, string> {
  if (!headers) return {};
  if (headers instanceof Headers) return Object.fromEntries(headers.entries());
  return { ...headers };
}

function decoded(response: IncomingMessage): Readable {
  const encoding = String(response.headers['content-encoding'] ?? '').toLowerCase();
  if (encoding === 'gzip' || encoding === 'x-gzip') return response.pipe(zlib.createGunzip());
  if (encoding === 'deflate') return response.pipe(zlib.createInflate());
  if (encoding === 'br') return response.pipe(zlib.createBrotliDecompress());
  return response;
}

function responseHeaders(response: IncomingMessage): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(response.headers)) {
    if (value === undefined) continue;
    // The body is handed over decoded, so its encoding and length no longer apply.
    if (name === 'content-encoding' || name === 'content-length') continue;
    if (Array.isArray(value)) for (const item of value) headers.append(name, item);
    else headers.set(name, value);
  }
  return headers;
}

export function guardedFetch(rawUrl: string, init: GuardedRequestInit = {}): Promise<Response> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return Promise.reject(new SsrfBlockedError(`malformed URL: ${rawUrl}`));
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return Promise.reject(new SsrfBlockedError(`scheme "${url.protocol}" is not permitted`));
  }
  // Node connects to an IP literal without calling `lookup`, so check it here.
  const literal = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(literal) && !isPublicAddress(literal)) {
    return Promise.reject(new SsrfBlockedError(`IP ${literal} is not a public address`));
  }
  const transport = url.protocol === 'https:' ? https : http;
  const headers: Record<string, string> = { 'accept-encoding': 'gzip, deflate, br', ...headerRecord(init.headers) };
  const body = init.body ?? null;
  if (body !== null && headers['content-length'] === undefined) {
    headers['content-length'] = String(typeof body === 'string' ? Buffer.byteLength(body) : body.byteLength);
  }

  return new Promise<Response>((resolve, reject) => {
    const request = transport.request(
      url,
      {
        method: init.method ?? 'GET',
        headers,
        ...(init.signal ? { signal: init.signal } : {}),
        lookup: publicOnlyLookup as unknown as typeof dnsLookup,
        // A fresh connection per request: a pooled socket could carry a different host.
        agent: false,
      },
      (response) => {
        const status = response.statusCode ?? 0;
        if (status >= 300 && status < 400 && init.redirect === 'error') {
          response.resume();
          reject(new TypeError(`redirect ${status} not allowed for ${init.method ?? 'GET'} ${url.toString()}`));
          return;
        }
        const hasBody = !NULL_BODY_STATUSES.has(status) && (init.method ?? 'GET').toUpperCase() !== 'HEAD';
        if (!hasBody) response.resume();
        const stream = hasBody ? decoded(response) : null;
        stream?.on('error', () => undefined);
        resolve(
          new Response(stream ? (Readable.toWeb(stream) as ReadableStream<Uint8Array>) : null, {
            status: status >= 200 && status <= 599 ? status : 502,
            statusText: response.statusMessage ?? '',
            headers: responseHeaders(response),
          }),
        );
      },
    );
    request.on('error', (error: Error) => {
      if (error instanceof PrivateAddressError) {
        reject(new SsrfBlockedError(`${url.hostname} resolves to a non-public address`));
        return;
      }
      reject(error);
    });
    if (body !== null) request.write(body);
    request.end();
  });
}
