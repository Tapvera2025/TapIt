import { ProviderError, SyncBudgetExhausted } from '../errors.js';
import type { TelephonyProvider } from '../types.js';

/**
 * One HTTP call to a calling platform.
 *
 *   - HTTPS to the platform's own hosts only. Pagination links come back from
 *     the platform, so a link to any other host is refused rather than
 *     followed with our credentials attached.
 *   - 429: waits until the platform's reset header (capped) and retries.
 *     JustCall's Team plan allows 30 requests a minute; a backfill hits that.
 *   - 5xx and network errors: two retries with a short backoff.
 *   - Every request counts against the run's budget so one sync cannot run
 *     for hours or burn the company's hourly quota.
 */

export interface RequestBudget {
  used: number;
  readonly max: number;
  /** Epoch ms after which no new request starts. */
  readonly deadline: number;
}

export function createBudget(max: number, durationMs: number, now = Date.now()): RequestBudget {
  return { used: 0, max, deadline: now + durationMs };
}

export interface ProviderHttpOptions {
  readonly provider: TelephonyProvider;
  readonly allowedHosts: readonly string[];
  readonly headers: Readonly<Record<string, string>>;
  readonly budget?: RequestBudget | undefined;
  readonly timeoutMs?: number;
  /**
   * Hosts a redirect may lead to (recording downloads are handed off to
   * storage). Credentials are dropped when a redirect leaves the API host.
   * Without this, any redirect is an error.
   */
  readonly redirectHosts?: readonly string[];
  /** Injected in tests. */
  readonly fetchImpl?: typeof fetch;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly now?: () => number;
}

const MAX_RATE_LIMIT_WAIT_MS = 65_000;
const MAX_RATE_LIMIT_RETRIES = 3;
const MAX_SERVER_RETRIES = 2;

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** A mock platform on this machine, for development and tests only. */
export const LOCAL_HOSTS: readonly string[] =
  process.env['NODE_ENV'] === 'production' ? [] : ['localhost', '127.0.0.1'];

export const PROVIDER_LABEL: Readonly<Record<TelephonyProvider, string>> = {
  justcall: 'JustCall',
  aircall: 'Aircall',
};

/**
 * Base URL override for local development and tests against a mock platform.
 * Ignored in production so a misconfigured environment cannot point the
 * company's keys at another server.
 */
export function providerBaseUrl(provider: TelephonyProvider, fallback: string): string {
  if (process.env['NODE_ENV'] === 'production') return fallback;
  const override = process.env[provider === 'justcall' ? 'TELEPHONY_JUSTCALL_API_BASE' : 'TELEPHONY_AIRCALL_API_BASE'];
  return override?.trim() ? override.trim().replace(/\/+$/, '') : fallback;
}

export function isAllowedUrl(url: URL, allowedHosts: readonly string[]): boolean {
  const host = url.hostname.toLowerCase();
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(host);
  if (url.protocol !== 'https:' && !(local && process.env['NODE_ENV'] !== 'production')) return false;
  if (url.username || url.password) return false;
  return allowedHosts.some((allowed) => {
    const rule = allowed.toLowerCase();
    return rule.startsWith('.') ? host.endsWith(rule) : host === rule;
  });
}

/** Seconds until a rate-limit window resets, from the platform's headers. */
export function rateLimitWaitMs(response: Response, now: number): number {
  const candidates = [
    response.headers.get('retry-after'),
    response.headers.get('x-rate-limit-burst-reset'),
    response.headers.get('x-rate-limit-reset'),
    response.headers.get('x-aircallapi-reset'),
  ];
  for (const raw of candidates) {
    if (!raw) continue;
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) continue;
    // Small numbers are "seconds from now"; large ones are an epoch (s or ms).
    if (value < 100_000) return Math.min(value * 1000, MAX_RATE_LIMIT_WAIT_MS);
    const epochMs = value > 1e12 ? value : value * 1000;
    return Math.min(Math.max(epochMs - now, 1000), MAX_RATE_LIMIT_WAIT_MS);
  }
  return 10_000;
}

/** The platform's wording on one line, without the full stop: the sentence around it ends with one. */
function tidyDetail(text: string): string | null {
  let tidy = text.replace(/\s+/g, ' ').trim();
  while (tidy.endsWith('.')) tidy = tidy.slice(0, -1).trimEnd();
  return tidy || null;
}

async function readErrorMessage(response: Response): Promise<string | null> {
  try {
    const text = (await response.text()).slice(0, 600);
    try {
      const body = JSON.parse(text) as Record<string, unknown>;
      const message = body['message'] ?? body['error'] ?? body['troubleshoot'];
      return tidyDetail(typeof message === 'string' ? message : text);
    } catch {
      return tidyDetail(text);
    }
  } catch {
    return null;
  }
}

export async function providerRequest(initialUrl: URL, options: ProviderHttpOptions, init: { method?: 'GET' } = {}): Promise<Response> {
  const label = PROVIDER_LABEL[options.provider];
  let url = initialUrl;
  if (!isAllowedUrl(url, options.allowedHosts)) {
    throw new ProviderError(`${label} returned a link to an unexpected address, so the sync stopped.`, 'invalid-response', null);
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? Date.now;
  let rateLimited = 0;
  let serverFailures = 0;
  let redirects = 0;
  let headers: Record<string, string> = { ...options.headers };
  const apiHost = url.hostname;

  for (;;) {
    if (options.budget) {
      if (options.budget.used >= options.budget.max || now() >= options.budget.deadline) throw new SyncBudgetExhausted();
      options.budget.used += 1;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 30_000);
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: init.method ?? 'GET',
        headers,
        signal: controller.signal,
        redirect: 'manual',
      });
    } catch {
      clearTimeout(timer);
      if (serverFailures < MAX_SERVER_RETRIES) {
        serverFailures += 1;
        await sleep(1000 * 2 ** serverFailures);
        continue;
      }
      throw new ProviderError(`${label} could not be reached. Try again in a few minutes.`, 'unavailable', null);
    }
    clearTimeout(timer);

    if (response.ok) return response;

    if (response.status >= 300 && response.status < 400 && options.redirectHosts && redirects < 3) {
      const location = response.headers.get('location');
      await response.body?.cancel().catch(() => undefined);
      const next = location ? new URL(location, url) : null;
      if (!next || !isAllowedUrl(next, [...options.allowedHosts, ...options.redirectHosts])) {
        throw new ProviderError(`${label} handed the download to an unexpected address, so it was not followed.`, 'invalid-response', response.status);
      }
      redirects += 1;
      if (next.hostname !== apiHost) {
        // Storage links are pre-signed; the API credentials stay with the API.
        headers = Object.fromEntries(Object.entries(headers).filter(([name]) => name.toLowerCase() !== 'authorization'));
      }
      url = next;
      continue;
    }

    if (response.status === 429) {
      const wait = rateLimitWaitMs(response, now());
      await response.body?.cancel().catch(() => undefined);
      if (rateLimited < MAX_RATE_LIMIT_RETRIES && (!options.budget || now() + wait < options.budget.deadline)) {
        rateLimited += 1;
        await sleep(wait);
        continue;
      }
      throw new ProviderError(`${label} is rate limiting requests from this account. The sync will continue later.`, 'rate-limited', 429);
    }

    if (response.status >= 500 && serverFailures < MAX_SERVER_RETRIES) {
      await response.body?.cancel().catch(() => undefined);
      serverFailures += 1;
      await sleep(1000 * 2 ** serverFailures);
      continue;
    }

    const detail = await readErrorMessage(response);
    if (response.status === 401 || response.status === 403) {
      throw new ProviderError(
        `${label} rejected the API credentials${detail ? `: ${detail}` : ''}. Check the key and secret, and that the plan includes API access.`,
        'rejected',
        response.status,
      );
    }
    if (response.status === 404) {
      throw new ProviderError(`${label} could not find that record${detail ? `: ${detail}` : ''}.`, 'not-found', 404);
    }
    if (response.status >= 300 && response.status < 400) {
      throw new ProviderError(`${label} redirected the request unexpectedly, so the sync stopped.`, 'invalid-response', response.status);
    }
    throw new ProviderError(
      `${label} returned an error (${response.status})${detail ? `: ${detail}` : ''}.`,
      response.status >= 500 ? 'unavailable' : 'invalid-response',
      response.status,
    );
  }
}

export async function providerJson(url: URL, options: ProviderHttpOptions): Promise<unknown> {
  const response = await providerRequest(url, options);
  try {
    const body: unknown = await response.json();
    return body;
  } catch {
    throw new ProviderError(`${PROVIDER_LABEL[options.provider]} returned a response that is not JSON.`, 'invalid-response', response.status);
  }
}
