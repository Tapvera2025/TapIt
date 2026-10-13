import { GoogleAuthUnavailableError, googleAccessToken } from './token.js';

/**
 * The two Search Console calls the SEO module needs.
 *
 * Errors are split the way TECH.md §9.8 asks: a fault in the configuration is
 * reported to the user and never retried, and a transient fault is thrown so
 * the job runner's backoff handles it (JB-4). Nothing here inspects an HTTP
 * status outside this file.
 */

const API_ROOT = 'https://www.googleapis.com/webmasters/v3';

/** Search Console's own ceiling for one response. */
const MAX_ROWS = 25_000;

/** Wrong credentials, a property the account cannot see, a malformed request. */
export class SearchConsoleConfigurationError extends Error {}
/** Rate limit or a Google-side fault. Retrying later is the correct response. */
export class SearchConsoleUnavailableError extends Error {}

export interface SearchConsoleSite {
  readonly siteUrl: string;
  readonly permissionLevel: string;
}

export type SearchConsoleDimension = 'query' | 'page' | 'country' | 'device' | 'date';

export interface SearchAnalyticsFilter {
  readonly dimension: 'query' | 'page' | 'country' | 'device';
  readonly operator: 'equals' | 'contains' | 'notContains';
  readonly expression: string;
}

export interface SearchAnalyticsRequest {
  readonly startDate: string;
  readonly endDate: string;
  readonly dimensions: readonly SearchConsoleDimension[];
  readonly filters?: readonly SearchAnalyticsFilter[];
  readonly rowLimit?: number;
}

export interface SearchAnalyticsRow {
  /** One entry per requested dimension, in the order they were requested. */
  readonly keys: readonly string[];
  readonly clicks: number;
  readonly impressions: number;
  readonly ctr: number;
  /** The AVERAGE position over the requested window — not a SERP rank. */
  readonly position: number;
}

interface ErrorBody {
  readonly error?: { readonly message?: string; readonly status?: string };
}

async function call<T>(path: string, init?: { body: unknown }): Promise<T> {
  let token: string;
  try {
    token = await googleAccessToken();
  } catch (cause) {
    if (cause instanceof GoogleAuthUnavailableError) throw new SearchConsoleConfigurationError(cause.message);
    throw new SearchConsoleUnavailableError(cause instanceof Error ? cause.message : String(cause));
  }

  let response: Response;
  try {
    response = await fetch(`${API_ROOT}${path}`, {
      method: init === undefined ? 'GET' : 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        ...(init === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(init === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
  } catch (cause) {
    throw new SearchConsoleUnavailableError(
      `Search Console unreachable: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }

  if (response.ok) return (await response.json()) as T;

  const body = (await response.json().catch(() => ({}))) as ErrorBody;
  const detail = body.error?.message ?? `HTTP ${response.status}`;

  // 429 and 5xx pass; everything else is the caller's or the credential's
  // fault and will fail identically on every retry.
  if (response.status === 429 || response.status >= 500) {
    throw new SearchConsoleUnavailableError(detail);
  }
  if (response.status === 401 || response.status === 403) {
    throw new SearchConsoleConfigurationError(
      `Search Console denied access: ${detail}. Confirm the Google account has access to this property.`,
    );
  }
  throw new SearchConsoleConfigurationError(detail);
}

/** Every property the configured account can read. */
export async function listSites(): Promise<SearchConsoleSite[]> {
  const payload = await call<{ siteEntry?: SearchConsoleSite[] }>('/sites');
  return payload.siteEntry ?? [];
}

/**
 * One Search Analytics query. `dataState` is left at Google's default
 * ('final'), so a partially-collected day never becomes an observation.
 */
export async function querySearchAnalytics(
  propertyUrl: string,
  request: SearchAnalyticsRequest,
): Promise<SearchAnalyticsRow[]> {
  const filters = request.filters ?? [];
  const payload = await call<{ rows?: SearchAnalyticsRow[] }>(
    `/sites/${encodeURIComponent(propertyUrl)}/searchAnalytics/query`,
    {
      body: {
        startDate: request.startDate,
        endDate: request.endDate,
        dimensions: request.dimensions,
        rowLimit: Math.min(request.rowLimit ?? MAX_ROWS, MAX_ROWS),
        type: 'web',
        ...(filters.length === 0 ? {} : { dimensionFilterGroups: [{ groupType: 'and', filters }] }),
      },
    },
  );
  return payload.rows ?? [];
}
