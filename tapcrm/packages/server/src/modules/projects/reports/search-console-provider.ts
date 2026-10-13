import {
  querySearchAnalytics,
  type SearchAnalyticsFilter,
  type SearchAnalyticsRow,
} from '../../../platform/integrations/google/search-console.js';
import type { RankProvider, RankRequest, RankResult, RankTargeting, RankWindow, Support } from './rank-provider.js';

/**
 * Google Search Console as a rank provider.
 *
 * What it reports is the AVERAGE POSITION at which the client's site appeared,
 * over the whole window, for queries that produced impressions. That is not a
 * SERP rank, and three consequences follow:
 *
 *   · a keyword the site does not rank for has no row at all, which is an
 *     honest `unavailable` rather than a missing reading;
 *   · the position is fractional, so `exactPosition` carries what Google said
 *     and `position` carries the rounded value the rank columns hold;
 *   · country and device are filterable, city is not, and Bing and the local
 *     pack are different products entirely — hence `supports`.
 */

export const SEARCH_CONSOLE_PROVIDER = 'search-console';

/**
 * Search Console filters countries by ISO-3166-1 alpha-3, lower case. The
 * keyword's country is free text, so alpha-3 passes through, alpha-2 and the
 * handful of names actually in use are mapped, and anything else is declined
 * by name — a typo must be visible, never silently fetched worldwide.
 */
const COUNTRY_ALIASES: Record<string, string> = {
  in: 'ind', india: 'ind',
  us: 'usa', usa: 'usa', 'united states': 'usa', 'united states of america': 'usa', america: 'usa',
  gb: 'gbr', uk: 'gbr', 'united kingdom': 'gbr', england: 'gbr', britain: 'gbr',
  ae: 'are', uae: 'are', 'united arab emirates': 'are', dubai: 'are',
  ca: 'can', canada: 'can',
  au: 'aus', australia: 'aus',
  sg: 'sgp', singapore: 'sgp',
  nz: 'nzl', 'new zealand': 'nzl',
  de: 'deu', germany: 'deu',
  fr: 'fra', france: 'fra',
  za: 'zaf', 'south africa': 'zaf',
  sa: 'sau', 'saudi arabia': 'sau',
  qa: 'qat', qatar: 'qat',
};

/** 'global' means every country, which Search Console expresses as no filter. */
const GLOBAL = new Set(['', 'global', 'all', 'worldwide', 'any']);

export type CountryFilter = { readonly kind: 'global' } | { readonly kind: 'country'; readonly code: string } | { readonly kind: 'unsupported' };

/** Exported for its own tests: the mapping is the easiest thing here to get wrong. */
export function resolveCountry(country: string): CountryFilter {
  const normalised = country.trim().toLowerCase();
  if (GLOBAL.has(normalised)) return { kind: 'global' };
  const alias = COUNTRY_ALIASES[normalised];
  if (alias !== undefined) return { kind: 'country', code: alias };
  // An unmapped three-letter code is almost certainly a valid alpha-3; Search
  // Console rejects it if not, and that lands as a configuration error.
  if (/^[a-z]{3}$/.test(normalised)) return { kind: 'country', code: normalised };
  return { kind: 'unsupported' };
}

export function supportsKeyword(targeting: RankTargeting): Support {
  if (targeting.searchEngine !== 'google') {
    return { ok: false, reason: 'Search Console covers Google only. Bing rankings stay manual.' };
  }
  if (targeting.category === 'gmb') {
    return { ok: false, reason: 'Search Console does not report Google Business Profile or local-pack rank. GMB keywords stay manual.' };
  }
  if (targeting.city !== null && targeting.city.trim() !== '') {
    return { ok: false, reason: 'Search Console has no city dimension — only country. City-scoped keywords stay manual.' };
  }
  if (resolveCountry(targeting.country).kind === 'unsupported') {
    return { ok: false, reason: `“${targeting.country}” is not a country Search Console recognises. Use a country name or ISO code, or “global”.` };
  }
  return { ok: true };
}

/**
 * Keywords sharing a country, device and target URL share one API response, so
 * they are fetched together: one call per group instead of one per keyword.
 * A project with 200 keywords on one site and one device costs a single call.
 */
interface Group {
  readonly filters: SearchAnalyticsFilter[];
  readonly requests: RankRequest[];
}

export function groupRequests(requests: readonly RankRequest[]): Map<string, Group> {
  const groups = new Map<string, Group>();
  for (const request of requests) {
    const country = resolveCountry(request.country);
    const page = request.targetUrl?.trim() ?? '';
    const key = `${country.kind === 'country' ? country.code : 'global'}|${request.device}|${page}`;

    let group = groups.get(key);
    if (group === undefined) {
      const filters: SearchAnalyticsFilter[] = [
        { dimension: 'device', operator: 'equals', expression: request.device.toUpperCase() },
      ];
      if (country.kind === 'country') {
        filters.push({ dimension: 'country', operator: 'equals', expression: country.code });
      }
      if (page !== '') {
        filters.push({ dimension: 'page', operator: 'equals', expression: page });
      }
      group = { filters, requests: [] };
      groups.set(key, group);
    }
    group.requests.push(request);
  }
  return groups;
}

/** Search Console lower-cases and trims the queries it stores. */
function matchKey(keyword: string): string {
  return keyword.trim().toLowerCase();
}

export function matchRows(rows: readonly SearchAnalyticsRow[], requests: readonly RankRequest[]): RankResult[] {
  const byQuery = new Map<string, SearchAnalyticsRow>();
  for (const row of rows) {
    const query = row.keys[0];
    if (query !== undefined) byQuery.set(matchKey(query), row);
  }

  return requests.map((request): RankResult => {
    const row = byQuery.get(matchKey(request.keyword));
    if (row === undefined) {
      // The response arrived and this keyword was not in it: either the site
      // does not rank for it, or it had too few impressions for Google to
      // report. Indistinguishable from here, and both mean "no rank today".
      return { keywordId: request.keywordId, status: 'unavailable', reason: rows.length === 0 ? 'no-data' : 'not-ranked' };
    }
    return {
      keywordId: request.keywordId,
      status: 'available',
      position: Math.max(1, Math.round(row.position)),
      exactPosition: Number(row.position.toFixed(2)),
      impressions: row.impressions,
      clicks: row.clicks,
      ctr: Number(row.ctr.toFixed(5)),
    };
  });
}

export function searchConsoleProvider(): RankProvider {
  return {
    name: SEARCH_CONSOLE_PROVIDER,
    supports: supportsKeyword,
    async fetchRanks(target, requests, window: RankWindow) {
      const results: RankResult[] = [];
      for (const group of groupRequests(requests).values()) {
        const rows = await querySearchAnalytics(target.propertyUrl, {
          startDate: window.start,
          endDate: window.end,
          dimensions: ['query'],
          filters: group.filters,
        });
        results.push(...matchRows(rows, group.requests));
      }
      return results;
    },
  };
}
