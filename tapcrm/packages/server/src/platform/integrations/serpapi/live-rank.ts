/**
 * Live search-results positions from SerpApi (https://serpapi.com).
 *
 * Search Console answers "on average, where did the site appear over a
 * window"; this answers "where is it on the results page right now", for a
 * country, city, device and engine. Three engines serve the three kinds of
 * keyword a project or website can hold:
 *
 *   google        organic results       paged with `start` (multiples of 10)
 *   bing          organic results       paged with `first` (1-based offset)
 *   google_local  the local (GMB) pack  paged with `start`; 10 or 20 a page
 *
 * Google stopped honouring `num=100` in September 2025, so going deeper than
 * the first page costs one more request per page. The caller decides how deep
 * to look and pays for each page through `beforePage`; this file never spends
 * a request it was not allowed. It asks for a next page only when SerpApi says
 * there is one (`serpapi_pagination.next`), so a short results list never
 * costs an extra, empty search.
 *
 * Shared by the Projects module (project keywords) and SEO intelligence
 * (website scans). Nothing here reads the database: it is pure enough to test
 * with a fake fetch.
 */

export const LIVE_PROVIDER = 'serpapi';
const ENDPOINT = 'https://serpapi.com/search.json';

/** The most results one check may look through. */
export const MAX_LIVE_DEPTH = 100;
/** Depths people can choose from. */
export const LIVE_DEPTHS = [10, 20, 30, 50, 100] as const;

export type LiveEngine = 'google' | 'bing' | 'google_local';

export interface LiveRankQuery {
  readonly keyword: string;
  readonly searchEngine: string;
  readonly category: 'seo' | 'gmb';
  readonly country: string;
  readonly city: string | null;
  readonly device: 'desktop' | 'mobile';
  /** The host to find, e.g. `acmedental.in`. Subdomains count as the same site. */
  readonly targetHost: string;
  /** For the local pack: a listing without a website is matched by its name. */
  readonly businessName: string | null;
  /** How many results to look through, at most. */
  readonly depth: number;
}

/** One of the first results on the page, shown so people see who ranks around them. */
export interface LiveTopResult {
  readonly position: number;
  readonly url: string | null;
  readonly title: string | null;
}

interface Common {
  readonly pagesRequested: number;
  readonly location: string;
  readonly engine: LiveEngine;
}

export type LiveRankResult =
  | (Common & {
      readonly status: 'found';
      readonly position: number;
      readonly url: string | null;
      readonly title: string | null;
      readonly resultsChecked: number;
      readonly topResults: readonly LiveTopResult[];
    })
  | (Common & {
      readonly status: 'not-found';
      readonly resultsChecked: number;
      readonly topResults: readonly LiveTopResult[];
    })
  | (Common & {
      readonly status: 'failed';
      /** Words a person reads. Never a provider body: it may echo the key. */
      readonly message: string;
      /** The allowance ran out before the planned depth was reached. */
      readonly allowanceExhausted: boolean;
    });

/** Country names, ISO alpha-2 and alpha-3 codes in use, to Google's two-letter `gl`. */
const COUNTRIES: Record<string, { code: string; name: string }> = {};
for (const [code, name, alpha3, ...aliases] of [
  ['in', 'India', 'ind', 'bharat'],
  ['us', 'United States', 'usa', 'united states of america', 'america'],
  ['uk', 'United Kingdom', 'gbr', 'gb', 'england', 'britain', 'great britain'],
  ['ae', 'United Arab Emirates', 'are', 'uae', 'dubai'],
  ['ca', 'Canada', 'can'],
  ['au', 'Australia', 'aus'],
  ['sg', 'Singapore', 'sgp'],
  ['nz', 'New Zealand', 'nzl'],
  ['de', 'Germany', 'deu'],
  ['fr', 'France', 'fra'],
  ['nl', 'Netherlands', 'nld'],
  ['za', 'South Africa', 'zaf'],
  ['sa', 'Saudi Arabia', 'sau'],
  ['qa', 'Qatar', 'qat'],
  ['pk', 'Pakistan', 'pak'],
  ['bd', 'Bangladesh', 'bgd'],
  ['np', 'Nepal', 'npl'],
  ['lk', 'Sri Lanka', 'lka'],
  ['my', 'Malaysia', 'mys'],
  ['id', 'Indonesia', 'idn'],
  ['ph', 'Philippines', 'phl'],
  ['jp', 'Japan', 'jpn'],
  ['kr', 'South Korea', 'kor', 'korea'],
  ['es', 'Spain', 'esp'],
  ['it', 'Italy', 'ita'],
  ['br', 'Brazil', 'bra'],
  ['mx', 'Mexico', 'mex'],
  ['ie', 'Ireland', 'irl'],
  ['se', 'Sweden', 'swe'],
  ['ch', 'Switzerland', 'che'],
  ['pl', 'Poland', 'pol'],
  ['om', 'Oman', 'omn'],
  ['kw', 'Kuwait', 'kwt'],
  ['bh', 'Bahrain', 'bhr'],
] as const) {
  const entry = { code, name };
  for (const key of [code, name.toLowerCase(), alpha3, ...aliases]) COUNTRIES[key] = entry;
}
const GLOBAL = new Set(['', 'global', 'all', 'worldwide', 'any']);

/** `null` country: no country filter at all. `undefined`: a country we cannot name. */
export function liveCountry(
  country: string,
): { code: string; name: string } | null | undefined {
  const key = country.trim().toLowerCase();
  if (GLOBAL.has(key)) return null;
  return COUNTRIES[key] ?? (/^[a-z]{2}$/.test(key) ? { code: key, name: key.toUpperCase() } : undefined);
}

/** Where the search runs, as SerpApi's `location` takes it and as people read it. */
export function liveLocation(city: string | null, country: { name: string } | null): string {
  const place = city?.trim();
  if (place && country) return `${place}, ${country.name}`;
  if (place) return place;
  return country?.name ?? 'Worldwide';
}

export function engineFor(query: Pick<LiveRankQuery, 'searchEngine' | 'category'>): LiveEngine {
  if (query.category === 'gmb') return 'google_local';
  return query.searchEngine === 'bing' ? 'bing' : 'google';
}

/** A depth people asked for, clamped to what one check may cost. */
export function clampDepth(depth: number | null | undefined, fallback = 30): number {
  const value = typeof depth === 'number' && Number.isFinite(depth) ? Math.trunc(depth) : fallback;
  return Math.min(MAX_LIVE_DEPTH, Math.max(10, value));
}

/** The host a URL belongs to, without `www.`, or null for anything but http(s). */
export function hostOf(value: string | null | undefined): string | null {
  if (!value) return null;
  const raw = value.trim();
  // A Search Console domain property names the host directly.
  const candidate = raw.toLowerCase().startsWith('sc-domain:') ? raw.slice('sc-domain:'.length) : raw;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(candidate) ? candidate : `https://${candidate}`);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    const host = url.hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
    return host.includes('.') ? host : null;
  } catch {
    return null;
  }
}

/** The same site: the host itself or any subdomain of it. */
function sameSite(candidate: string | null, target: string): boolean {
  const host = hostOf(candidate);
  return host !== null && (host === target || host.endsWith(`.${target}`));
}

function normalisedName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

interface Item {
  position: number;
  url: string | null;
  title: string | null;
}
type Json = Record<string, unknown>;
const object = (value: unknown): Json =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : {};
const text = (value: unknown): string | null => (typeof value === 'string' && value ? value : null);

/**
 * One page of results as absolute positions. SerpApi numbers results either
 * across pages (page two starts at 11) or from 1 on every page. A page that
 * restarts its numbering always holds a position 1, so that is what tells the
 * two apart; a missing number falls back to the item's order on the page.
 */
export function pageItems(engine: LiveEngine, body: Json, offset: number): Item[] {
  const list = engine === 'google_local' ? body['local_results'] : body['organic_results'];
  if (!Array.isArray(list)) return [];
  const reported = list.map((raw) => {
    const value = object(raw)['position'];
    return typeof value === 'number' && Number.isFinite(value) && value >= 1 ? Math.trunc(value) : null;
  });
  const restarted = offset > 0 && reported.some((value) => value === 1);
  return list.map((raw, index) => {
    const item = object(raw);
    const own = reported[index] ?? null;
    const position = own === null ? offset + index + 1 : restarted ? offset + own : own;
    const links = object(item['links']);
    return {
      position,
      url: text(item['link']) ?? text(links['website']) ?? text(item['website']),
      title: text(item['title']),
    };
  });
}

function matches(item: Item, query: LiveRankQuery, engine: LiveEngine): boolean {
  if (sameSite(item.url, query.targetHost)) return true;
  if (engine !== 'google_local' || !query.businessName || !item.title) return false;
  const name = normalisedName(query.businessName);
  const title = normalisedName(item.title);
  if (name.length < 3 || title.length < 3) return false;
  // "Acme Dental Clinic — Bandra" is the listing of "Acme Dental Clinic"; a
  // listing named "Acme Dental" is the business "Acme Dental Clinic Pvt Ltd".
  return title.includes(name) || (title.length >= 8 && name.includes(title));
}

/** The request for one page. Exported for its tests: the parameters are the contract. */
export function pageRequest(
  query: LiveRankQuery,
  offset: number,
  apiKey: string,
): { url: string; engine: LiveEngine; location: string } {
  const engine = engineFor(query);
  const country = liveCountry(query.country) ?? null;
  const location = liveLocation(query.city, country);
  const params = new URLSearchParams({ engine, q: query.keyword, api_key: apiKey, output: 'json' });
  if (engine === 'bing') {
    if (country) params.set('cc', country.code === 'uk' ? 'gb' : country.code);
    if (offset > 0) params.set('first', String(offset + 1));
  } else {
    params.set('hl', 'en');
    if (country) params.set('gl', country.code);
    if (offset > 0) params.set('start', String(offset));
  }
  // Only a city narrows the place; a country alone is what gl/cc already say.
  if (query.city?.trim()) params.set('location', location);
  params.set('device', query.device);
  return { url: `${ENDPOINT}?${params.toString()}`, engine, location };
}

/** SerpApi answers an empty results page with an `error` string, not an empty list. */
function emptyResults(message: string): boolean {
  return /hasn't returned any results|has not returned any results|no results/i.test(message);
}

/** Where SerpApi says the next page starts, or null when there is no next page. */
export function nextOffset(engine: LiveEngine, body: Json, offset: number, itemCount: number): number | null {
  const pagination = object(body['serpapi_pagination']);
  const next = text(pagination['next']) ?? text(pagination['next_link']);
  if (!next || itemCount === 0) return null;
  try {
    const params = new URL(next).searchParams;
    const value = engine === 'bing' ? Number(params.get('first')) - 1 : Number(params.get('start'));
    if (Number.isInteger(value) && value > offset) return value;
  } catch {
    // An unreadable link: fall through to counting.
  }
  return engine === 'google' ? offset + 10 : offset + itemCount;
}

/**
 * Looks through results pages until the site is found or `depth` results have
 * been seen. `beforePage` reserves the allowance for each page; returning false
 * stops the search there (the allowance ran out).
 */
export async function checkLiveRank(
  query: LiveRankQuery,
  options: {
    readonly apiKey: string;
    readonly beforePage: () => Promise<boolean>;
    readonly fetch?: typeof fetch;
    readonly timeoutMs?: number;
  },
): Promise<LiveRankResult> {
  const engine = engineFor(query);
  const country = liveCountry(query.country);
  const location = liveLocation(query.city, country ?? null);
  const base = { engine, location } as const;
  if (country === undefined)
    return {
      status: 'failed',
      message: `“${query.country}” is not a country the live check knows. Use a country name or its two-letter code.`,
      pagesRequested: 0,
      allowanceExhausted: false,
      ...base,
    };
  const depth = clampDepth(query.depth, MAX_LIVE_DEPTH);
  const doFetch = options.fetch ?? fetch;
  const topResults: LiveTopResult[] = [];
  let offset = 0;
  let seen = 0;
  let pages = 0;
  for (;;) {
    if (!(await options.beforePage()))
      return {
        status: 'failed',
        message:
          pages === 0
            ? 'The monthly live-check allowance is used up (or not set).'
            : `The allowance ran out after the first ${seen} results; the site was not in them.`,
        pagesRequested: pages,
        allowanceExhausted: true,
        ...base,
      };
    pages += 1;
    const request = pageRequest(query, offset, options.apiKey);
    let body: Json;
    try {
      const response = await doFetch(request.url, {
        signal: AbortSignal.timeout(options.timeoutMs ?? 45_000),
        redirect: 'error',
      });
      body = object(await response.json().catch(() => ({})));
      const error = text(body['error']);
      if (error && emptyResults(error)) body = {};
      else if (!response.ok || error)
        return {
          status: 'failed',
          message:
            response.status === 401
              ? 'The search provider rejected the server’s API key.'
              : response.status === 429
                ? 'The search provider’s own plan limit was reached. Try again later.'
                : 'The search provider could not run this search. Try again later.',
          pagesRequested: pages,
          allowanceExhausted: false,
          ...base,
        };
    } catch {
      return {
        status: 'failed',
        message: 'The search provider could not be reached. Try again later.',
        pagesRequested: pages,
        allowanceExhausted: false,
        ...base,
      };
    }
    const items = pageItems(engine, body, offset);
    for (const item of items) if (topResults.length < 5) topResults.push(item);
    const hit = items.find((item) => matches(item, query, engine));
    seen += items.length;
    if (hit)
      return {
        status: 'found',
        position: hit.position,
        url: hit.url,
        title: hit.title,
        resultsChecked: seen,
        pagesRequested: pages,
        topResults,
        ...base,
      };
    const next = nextOffset(engine, body, offset, items.length);
    if (next === null || seen >= depth || next >= depth) break;
    offset = next;
  }
  return { status: 'not-found', resultsChecked: seen, pagesRequested: pages, topResults, ...base };
}
