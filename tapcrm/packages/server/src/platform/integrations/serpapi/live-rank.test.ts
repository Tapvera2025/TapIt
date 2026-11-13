import { describe, expect, it } from 'vitest';
import {
  checkLiveRank,
  engineFor,
  hostOf,
  liveCountry,
  liveLocation,
  pageItems,
  nextOffset,
  pageRequest,
  clampDepth,
  type LiveRankQuery,
} from './live-rank.js';

const base: LiveRankQuery = {
  keyword: 'best dentist',
  searchEngine: 'google',
  category: 'seo',
  country: 'india',
  city: null,
  device: 'desktop',
  targetHost: 'acmedental.in',
  businessName: null,
  depth: 100,
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
function organic(items: Array<{ position?: number; link?: string }>, next?: string) {
  return { organic_results: items, ...(next ? { serpapi_pagination: { next } } : {}) };
}
const href = (input: string | URL | Request): string =>
  typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
const nextPage = (start: number) => `https://serpapi.com/search.json?engine=google&q=x&start=${start}`;

describe('live rank provider — pure helpers', () => {
  it('maps country names, codes and global', () => {
    expect(liveCountry('India')).toEqual({ code: 'in', name: 'India' });
    expect(liveCountry('us')).toEqual({ code: 'us', name: 'United States' });
    expect(liveCountry('gbr')).toEqual({ code: 'uk', name: 'United Kingdom' });
    expect(liveCountry('global')).toBeNull();
    expect(liveCountry('Narnia')).toBeUndefined();
    // An unknown two-letter code passes through — the provider validates it.
    expect(liveCountry('pt')).toEqual({ code: 'pt', name: 'PT' });
  });

  it('describes the search location for people', () => {
    expect(liveLocation('Mumbai', { name: 'India' })).toBe('Mumbai, India');
    expect(liveLocation(null, { name: 'India' })).toBe('India');
    expect(liveLocation(null, null)).toBe('Worldwide');
  });

  it('chooses the engine and clamps the depth', () => {
    expect(engineFor({ searchEngine: 'google', category: 'seo' })).toBe('google');
    expect(engineFor({ searchEngine: 'bing', category: 'seo' })).toBe('bing');
    expect(engineFor({ searchEngine: 'google', category: 'gmb' })).toBe('google_local');
    expect(clampDepth(5)).toBe(10);
    expect(clampDepth(500)).toBe(100);
    expect(clampDepth(undefined)).toBe(30);
  });

  it('follows SerpApi’s own next link, and stops without one', () => {
    expect(nextOffset('google', organic([{ position: 1 }], nextPage(10)), 0, 9)).toBe(10);
    expect(nextOffset('google', organic([{ position: 1 }]), 0, 9)).toBeNull();
    expect(nextOffset('google_local', { serpapi_pagination: { next: 'https://serpapi.com/search.json?engine=google_local&start=20' } }, 0, 20)).toBe(20);
    expect(nextOffset('bing', { serpapi_pagination: { next: 'https://serpapi.com/search.json?engine=bing&first=11' } }, 0, 10)).toBe(10);
    // Nothing on the page: never pay for another.
    expect(nextOffset('google', organic([], nextPage(10)), 0, 0)).toBeNull();
  });

  it('extracts a host without www and rejects non-http', () => {
    expect(hostOf('https://www.acmedental.in/book')).toBe('acmedental.in');
    expect(hostOf('acmedental.in')).toBe('acmedental.in');
    expect(hostOf('ftp://x.test')).toBeNull();
    expect(hostOf('not a url')).toBeNull();
    expect(hostOf('sc-domain:acmedental.in')).toBe('acmedental.in');
    expect(hostOf(null)).toBeNull();
  });

  it('builds the request with country, device and pagination', () => {
    const page0 = pageRequest(base, 0, 'KEY');
    const url0 = new URL(page0.url);
    expect(url0.searchParams.get('engine')).toBe('google');
    expect(url0.searchParams.get('gl')).toBe('in');
    expect(url0.searchParams.get('device')).toBe('desktop');
    expect(url0.searchParams.get('start')).toBeNull();
    expect(url0.searchParams.get('location')).toBeNull(); // no city → no location
    const page2 = pageRequest(base, 20, 'KEY');
    expect(new URL(page2.url).searchParams.get('start')).toBe('20');
    const city = pageRequest({ ...base, city: 'Mumbai' }, 10, 'KEY');
    expect(new URL(city.url).searchParams.get('location')).toBe('Mumbai, India');
    const bing = pageRequest({ ...base, searchEngine: 'bing' }, 10, 'KEY');
    expect(new URL(bing.url).searchParams.get('first')).toBe('11');
    expect(new URL(bing.url).searchParams.get('cc')).toBe('in');
  });

  it('numbers results across pages and reads the ranking link', () => {
    // Page numbering that restarts at 1 is shifted by the offset.
    const items = pageItems('google', organic([{ position: 1, link: 'https://a.test' }, { link: 'https://b.test' }]), 10);
    expect(items).toEqual([
      { position: 11, url: 'https://a.test', title: null },
      { position: 12, url: 'https://b.test', title: null },
    ]);
    // Numbering that continues across pages is kept, even after a short first page.
    const continued = pageItems('google', organic([{ position: 10, link: 'https://c.test' }, { position: 11, link: 'https://d.test' }]), 10);
    expect(continued.map((item) => item.position)).toEqual([10, 11]);
    const local = pageItems('google_local', { local_results: [{ position: 3, title: 'Acme', links: { website: 'https://acme.test' } }] }, 0);
    expect(local[0]).toMatchObject({ position: 3, url: 'https://acme.test', title: 'Acme' });
  });
});

describe('checkLiveRank', () => {
  const allow = () => Promise.resolve(true);

  it('finds the site on the first page and counts one page', async () => {
    let pages = 0;
    const result = await checkLiveRank(base, {
      apiKey: 'KEY',
      beforePage: () => { pages += 1; return Promise.resolve(true); },
      fetch: async () => json(organic([
        { position: 1, link: 'https://other.test' },
        { position: 2, link: 'https://www.acmedental.in/book' },
      ])),
    });
    expect(result).toMatchObject({ status: 'found', position: 2, url: 'https://www.acmedental.in/book', pagesRequested: 1 });
    expect(pages).toBe(1);
  });

  it('pages until the site is found, paying for each page', async () => {
    const calls: string[] = [];
    const result = await checkLiveRank(base, {
      apiKey: 'KEY',
      beforePage: allow,
      fetch: async (url) => {
        calls.push(new URL(href(url)).searchParams.get('start') ?? '0');
        const start = Number(new URL(href(url)).searchParams.get('start') ?? '0');
        return json(organic(
          start === 10
            ? [{ position: 11, link: 'https://acmedental.in/' }]
            // Google often returns fewer than ten organic results on a page.
            : Array.from({ length: 9 }, (_, i) => ({ position: i + 1 + start, link: `https://x${i}.test` })),
          nextPage(start + 10),
        ));
      },
    });
    expect(result).toMatchObject({ status: 'found', position: 11, pagesRequested: 2, resultsChecked: 10 });
    if (result.status === 'found') expect(result.topResults).toHaveLength(5);
    expect(calls).toEqual(['0', '10']);
  });

  it('never looks past the depth asked for', async () => {
    const calls: string[] = [];
    const result = await checkLiveRank({ ...base, depth: 20 }, {
      apiKey: 'KEY',
      beforePage: allow,
      fetch: async (url) => {
        const start = Number(new URL(href(url)).searchParams.get('start') ?? '0');
        calls.push(String(start));
        return json(organic(Array.from({ length: 10 }, (_, i) => ({ position: i + 1, link: `https://y${i}.test` })), nextPage(start + 10)));
      },
    });
    expect(result).toMatchObject({ status: 'not-found', resultsChecked: 20, pagesRequested: 2 });
    expect(calls).toEqual(['0', '10']);
  });

  it('stops part-way when the allowance runs out', async () => {
    let left = 1;
    const result = await checkLiveRank(base, {
      apiKey: 'KEY',
      beforePage: () => Promise.resolve(left-- > 0),
      fetch: async () => json(organic([{ position: 1, link: 'https://z.test' }], nextPage(10))),
    });
    expect(result).toMatchObject({ status: 'failed', allowanceExhausted: true, pagesRequested: 1 });
  });

  it('stops when the allowance runs out and says so', async () => {
    const result = await checkLiveRank(base, {
      apiKey: 'KEY',
      beforePage: () => Promise.resolve(false),
      fetch: async () => json(organic([])),
    });
    expect(result).toMatchObject({ status: 'failed', allowanceExhausted: true, pagesRequested: 0 });
  });

  it('reports a not-found after looking through what the engine returned', async () => {
    const result = await checkLiveRank({ ...base, depth: 20 }, {
      apiKey: 'KEY',
      beforePage: allow,
      fetch: async () => json(organic([{ position: 1, link: 'https://nope.test' }])),
    });
    expect(result).toMatchObject({ status: 'not-found', resultsChecked: 1 });
  });

  it('refuses an unknown country before spending anything', async () => {
    let called = false;
    const result = await checkLiveRank({ ...base, country: 'Narnia' }, {
      apiKey: 'KEY',
      beforePage: () => { called = true; return Promise.resolve(true); },
      fetch: async () => json(organic([])),
    });
    expect(result.status).toBe('failed');
    expect(called).toBe(false);
  });

  it('surfaces a provider rejection without leaking the body', async () => {
    const result = await checkLiveRank(base, {
      apiKey: 'KEY',
      beforePage: allow,
      fetch: async () => json({ error: 'Invalid API key: secret-123' }, 401),
    });
    expect(result.status).toBe('failed');
    if (result.status === 'failed') expect(result.message).not.toContain('secret-123');
  });

  it('does not mistake a listing that merely contains a search word for the business', async () => {
    const result = await checkLiveRank(
      { ...base, category: 'gmb', businessName: 'Acme Dental Clinic', depth: 20 },
      {
        apiKey: 'KEY',
        beforePage: allow,
        fetch: async () => json({ local_results: [{ position: 1, title: 'Best Dentist Mumbai' }, { position: 2, title: 'Dental' }] }),
      },
    );
    expect(result.status).toBe('not-found');
  });

  it('matches a local-pack listing by business name when it has no website', async () => {
    const result = await checkLiveRank(
      { ...base, category: 'gmb', businessName: 'Acme Dental Clinic', depth: 20 },
      {
        apiKey: 'KEY',
        beforePage: allow,
        fetch: async () => json({ local_results: [
          { position: 1, title: 'Bright Smiles' },
          { position: 2, title: 'Acme Dental Clinic — Bandra' },
        ] }),
      },
    );
    expect(result).toMatchObject({ status: 'found', position: 2, engine: 'google_local' });
  });

  it('treats an empty-results error as not-found, not a failure', async () => {
    const result = await checkLiveRank({ ...base, depth: 10 }, {
      apiKey: 'KEY',
      beforePage: allow,
      fetch: async () => json({ error: "Google hasn't returned any results for this query." }),
    });
    expect(result.status).toBe('not-found');
  });
});
