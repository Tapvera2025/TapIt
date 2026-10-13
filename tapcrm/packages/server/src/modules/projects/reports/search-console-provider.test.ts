import { describe, expect, it } from 'vitest';
import type { SearchAnalyticsRow } from '../../../platform/integrations/google/search-console.js';
import type { RankRequest } from './rank-provider.js';
import { groupRequests, matchRows, resolveCountry, supportsKeyword } from './search-console-provider.js';

/**
 * The provider's pure parts. Everything that decides WHICH keywords reach
 * Google, HOW MANY calls that costs, and how a response maps back onto
 * keywords is tested here without a network.
 */

const request = (over: Partial<RankRequest> = {}): RankRequest => ({
  keywordId: over.keywordId ?? 'k1',
  keyword: over.keyword ?? 'web design company',
  targetUrl: over.targetUrl ?? null,
  searchEngine: over.searchEngine ?? 'google',
  category: over.category ?? 'seo',
  country: over.country ?? 'global',
  city: over.city ?? null,
  device: over.device ?? 'desktop',
});

const row = (query: string, over: Partial<SearchAnalyticsRow> = {}): SearchAnalyticsRow => ({
  keys: [query],
  clicks: over.clicks ?? 3,
  impressions: over.impressions ?? 120,
  ctr: over.ctr ?? 0.025,
  position: over.position ?? 14.3,
});

describe('resolveCountry', () => {
  it('treats the keyword table default as no filter', () => {
    for (const value of ['global', 'Global', '  ', 'worldwide']) {
      expect(resolveCountry(value).kind).toBe('global');
    }
  });

  it('maps names and alpha-2 codes onto the alpha-3 Search Console wants', () => {
    expect(resolveCountry('India')).toEqual({ kind: 'country', code: 'ind' });
    expect(resolveCountry('in')).toEqual({ kind: 'country', code: 'ind' });
    expect(resolveCountry('United Kingdom')).toEqual({ kind: 'country', code: 'gbr' });
    expect(resolveCountry('UAE')).toEqual({ kind: 'country', code: 'are' });
  });

  it('passes an alpha-3 code through unchanged', () => {
    expect(resolveCountry('BRA')).toEqual({ kind: 'country', code: 'bra' });
  });

  it('declines anything it cannot resolve, rather than silently going global', () => {
    // The dangerous failure: a typo quietly fetching worldwide numbers and
    // presenting them as the country's rank.
    expect(resolveCountry('Inida').kind).toBe('unsupported');
    expect(resolveCountry('Mumbai').kind).toBe('unsupported');
  });
});

describe('supportsKeyword', () => {
  it('accepts a Google, country-level, SEO keyword', () => {
    expect(supportsKeyword(request()).ok).toBe(true);
    expect(supportsKeyword(request({ country: 'India' })).ok).toBe(true);
  });

  it('declines Bing, GMB and city-scoped keywords with a reason', () => {
    for (const over of [{ searchEngine: 'bing' }, { category: 'gmb' as const }, { city: 'Jaipur' }]) {
      const support = supportsKeyword(request(over));
      expect(support.ok).toBe(false);
      if (!support.ok) expect(support.reason.length).toBeGreaterThan(0);
    }
  });

  it('treats a blank city as no city', () => {
    expect(supportsKeyword(request({ city: '   ' })).ok).toBe(true);
  });

  it('declines an unresolvable country', () => {
    expect(supportsKeyword(request({ country: 'Inida' })).ok).toBe(false);
  });
});

describe('groupRequests', () => {
  it('collapses keywords sharing country, device and page into one call', () => {
    const groups = groupRequests([
      request({ keywordId: 'a', keyword: 'one' }),
      request({ keywordId: 'b', keyword: 'two' }),
      request({ keywordId: 'c', keyword: 'three' }),
    ]);
    expect(groups.size).toBe(1);
    expect([...groups.values()][0]?.requests).toHaveLength(3);
  });

  it('splits on each dimension that changes the query', () => {
    const groups = groupRequests([
      request({ keywordId: 'a' }),
      request({ keywordId: 'b', device: 'mobile' }),
      request({ keywordId: 'c', country: 'India' }),
      request({ keywordId: 'd', targetUrl: 'https://example.com/services' }),
    ]);
    expect(groups.size).toBe(4);
  });

  it('builds the filters Search Console expects', () => {
    const groups = groupRequests([request({ country: 'India', device: 'mobile', targetUrl: 'https://example.com/x' })]);
    const filters = [...groups.values()][0]?.filters ?? [];
    expect(filters).toEqual(
      expect.arrayContaining([
        { dimension: 'device', operator: 'equals', expression: 'MOBILE' },
        { dimension: 'country', operator: 'equals', expression: 'ind' },
        { dimension: 'page', operator: 'equals', expression: 'https://example.com/x' },
      ]),
    );
  });

  it('omits the country filter for a global keyword', () => {
    const filters = [...groupRequests([request()]).values()][0]?.filters ?? [];
    expect(filters.some((filter) => filter.dimension === 'country')).toBe(false);
  });
});

describe('matchRows', () => {
  it('matches case-insensitively and rounds the average position', () => {
    const results = matchRows([row('Web Design Company', { position: 14.3 })], [request()]);
    expect(results[0]).toEqual({
      keywordId: 'k1',
      status: 'available',
      position: 14,
      exactPosition: 14.3,
      impressions: 120,
      clicks: 3,
      ctr: 0.025,
    });
  });

  it('never rounds a top result down to zero', () => {
    // position 1.2 rounds to 1; the rank columns start at 1, so a 0 would
    // violate the CHECK and lose the observation.
    const results = matchRows([row('web design company', { position: 1.2 })], [request()]);
    expect(results[0]).toMatchObject({ status: 'available', position: 1 });
  });

  it('reports a keyword absent from a non-empty response as not ranked', () => {
    const results = matchRows([row('something else')], [request()]);
    expect(results[0]).toEqual({ keywordId: 'k1', status: 'unavailable', reason: 'not-ranked' });
  });

  it('distinguishes an empty response as no data for the window', () => {
    const results = matchRows([], [request()]);
    expect(results[0]).toEqual({ keywordId: 'k1', status: 'unavailable', reason: 'no-data' });
  });

  it('returns exactly one result per request', () => {
    const requests = [request({ keywordId: 'a', keyword: 'one' }), request({ keywordId: 'b', keyword: 'two' })];
    const results = matchRows([row('one')], requests);
    expect(results.map((result) => result.keywordId)).toEqual(['a', 'b']);
  });
});
