import { guardUrl, SsrfBlockedError } from './ssrf-guard.js';

export interface FetchHop {
  url: string;
  status: number;
}

export interface FetchResult {
  finalUrl: string;
  status: number;
  headers: Record<string, string>;
  body: string;
  byteLength: number;
  truncated: boolean;
  elapsedMs: number;
  redirectChain: FetchHop[];
}

export interface FetchOptions {
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  userAgent?: string;
  acceptLanguage?: string;
  /** HTTP method. Defaults to GET. */
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Extra request headers merged over the defaults. */
  headers?: Record<string, string>;
  /** Request body for POST/PUT/PATCH. */
  body?: string | Uint8Array;
}

const DEFAULT_TIMEOUT = 15_000;
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024; // 5 MiB
const DEFAULT_MAX_REDIRECTS = 5;
const DEFAULT_UA = 'TapcrmSeoBot/1.0 (+https://tapcrm.local/bots)';

export class FetchError extends Error {
  readonly reason?: unknown;
  constructor(message: string, reason?: unknown) {
    super(message);
    this.reason = reason;
  }
}

export class FetchTimeoutError extends FetchError {
  constructor(ms: number) {
    super(`fetch timed out after ${ms}ms`);
  }
}

export class RedirectLoopError extends FetchError {
  constructor(hops: number) {
    super(`exceeded redirect limit (${hops})`);
  }
}

/**
 * Fetches a URL with SSRF protection, redirect-chain tracking, byte caps, and timing.
 * Re-validates every redirect target to defeat DNS rebinding and open-redirect SSRF.
 * Returns up to `maxBytes` of the body as a UTF-8 string; sets `truncated` when the cap hit.
 */
export async function safeFetch(url: string, opts: FetchOptions = {}): Promise<FetchResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT;
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxRedirects = opts.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const userAgent = opts.userAgent ?? DEFAULT_UA;
  const acceptLanguage = opts.acceptLanguage ?? 'en';
  const method = opts.method ?? 'GET';

  const headers: Record<string, string> = {
    'user-agent': userAgent,
    'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'accept-language': acceptLanguage,
    ...(opts.headers ?? {}),
  };

  const started = Date.now();
  const redirectChain: FetchHop[] = [];
  let current = url;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    await guardUrl(current);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      response = await fetch(current, {
        method,
        headers,
        // Only GET requests follow redirects (safe); non-GET requests are sent
        // once to the resolved URL since redirecting a POST silently changes
        // method semantics in surprising ways.
        redirect: method === 'GET' ? 'manual' : 'error',
        ...(opts.body !== undefined ? { body: opts.body } : {}),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof SsrfBlockedError) throw err;
      if ((err as { name?: string }).name === 'AbortError') throw new FetchTimeoutError(timeoutMs);
      throw new FetchError(`fetch failed for ${current}`, err);
    }
    clearTimeout(timer);

    const status = response.status;

    if (status >= 300 && status < 400) {
      redirectChain.push({ url: current, status });
      const location = response.headers.get('location');
      if (!location) throw new FetchError(`redirect ${status} without Location header at ${current}`);
      let next: string;
      try {
        next = new URL(location, current).toString();
      } catch {
        throw new FetchError(`invalid redirect target "${location}" at ${current}`);
      }
      current = next;
      // Drain the redirect body so the socket releases cleanly.
      try { await response.arrayBuffer(); } catch { /* ignore */ }
      continue;
    }

    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => { responseHeaders[key] = value; });

    const { body, byteLength, truncated } = await readCapped(response, maxBytes, timeoutMs - (Date.now() - started));

    return {
      finalUrl: current,
      status,
      headers: responseHeaders,
      body,
      byteLength,
      truncated,
      elapsedMs: Date.now() - started,
      redirectChain,
    };
  }

  throw new RedirectLoopError(maxRedirects);
}

async function readCapped(
  response: Response,
  maxBytes: number,
  remainingMs: number,
): Promise<{ body: string; byteLength: number; truncated: boolean }> {
  if (!response.body) return { body: '', byteLength: 0, truncated: false };

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;

  const deadline = Date.now() + Math.max(remainingMs, 1000);

  try {
    while (true) {
      if (Date.now() > deadline) {
        try { await reader.cancel(); } catch { /* ignore */ }
        throw new FetchTimeoutError(remainingMs);
      }
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        const excess = total - maxBytes;
        chunks.push(value.subarray(0, value.byteLength - excess));
        truncated = true;
        try { await reader.cancel(); } catch { /* ignore */ }
        break;
      }
      chunks.push(value);
    }
  } finally {
    try { reader.releaseLock(); } catch { /* ignore */ }
  }

  const merged = new Uint8Array(truncated ? maxBytes : total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return {
    body: new TextDecoder('utf-8', { fatal: false }).decode(merged),
    byteLength: truncated ? maxBytes : total,
    truncated,
  };
}
