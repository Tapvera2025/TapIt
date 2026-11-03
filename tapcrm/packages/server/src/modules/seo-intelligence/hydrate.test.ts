/**
 * Guards against the snake_case/camelCase bug class: the DAL camelizes rows, so
 * every observation DB row arrives with camelCase keys. If someone adds a new
 * field and reads it as snake_case (which is tempting because the SQL and the
 * schema use snake_case), hydrateObservation would silently produce `undefined`.
 * These tests feed a camelized row through and assert the fields flow through.
 */
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { hydrateObservation, type HydrationMaps, type ObservationRow } from './hydrate.js';

function hashUrl(url: string): string {
  return createHash('sha256').update(url).digest('hex');
}

function emptyMaps(nowMs = Date.now()): HydrationMaps {
  return {
    outboundBySourceHash: new Map(),
    inboundInternalCountByTargetHash: new Map(),
    sitemapByUrl: new Map(),
    hreflangMissingByUrl: new Map(),
    duplicateOfByUrl: new Map(),
    clicksByUrl: new Map(),
    lhScoreByUrl: new Map(),
    seedUrlHashes: new Set(),
    originCruxLcp: null,
    originCruxInp: null,
    originCruxCls: null,
    nowMs,
  };
}

function baseRow(overrides: Partial<ObservationRow> = {}): ObservationRow {
  return {
    id: 'obs-1',
    url: 'https://example.com/',
    httpStatus: 200,
    finalUrl: 'https://example.com/',
    title: 'Welcome',
    metaDescription: 'Example home',
    metaRobots: 'index,follow',
    canonicalLink: 'https://example.com/',
    canonicalHeader: null,
    xRobotsTag: null,
    lang: 'en',
    h1Texts: ['Welcome'],
    contentHash: 'abc123',
    contentType: 'text/html',
    contentLength: 1024,
    responseTimeMs: 200,
    structuredData: [],
    hreflangEntries: [],
    redirectChain: [],
    wordCount: 300,
    images: [],
    schemaErrors: [],
    renderMode: 'raw',
    domHash: null,
    ...overrides,
  };
}

describe('hydrateObservation — field passthrough from camelized rows', () => {
  it('populates every scalar from the row (not undefined)', () => {
    const obs = hydrateObservation(baseRow(), emptyMaps());
    expect(obs.url).toBe('https://example.com/');
    expect(obs.httpStatus).toBe(200);
    expect(obs.finalUrl).toBe('https://example.com/');
    expect(obs.title).toBe('Welcome');
    expect(obs.metaDescription).toBe('Example home');
    expect(obs.metaRobots).toBe('index,follow');
    expect(obs.canonicalLink).toBe('https://example.com/');
    expect(obs.lang).toBe('en');
    expect(obs.contentHash).toBe('abc123');
    expect(obs.contentType).toBe('text/html');
    expect(obs.contentLength).toBe(1024);
    expect(obs.responseTimeMs).toBe(200);
    expect(obs.wordCount).toBe(300);
  });

  it('derives h1Count/h1Text from the array', () => {
    expect(hydrateObservation(baseRow({ h1Texts: [] }), emptyMaps()).h1Count).toBe(0);
    expect(hydrateObservation(baseRow({ h1Texts: ['A', 'B', 'C'] }), emptyMaps()).h1Count).toBe(3);
    expect(hydrateObservation(baseRow({ h1Texts: ['A', 'B'] }), emptyMaps()).h1Text).toBe('A');
    expect(hydrateObservation(baseRow({ h1Texts: [] }), emptyMaps()).h1Text).toBeNull();
  });

  it('rawContentHash mirrors contentHash (same source)', () => {
    const obs = hydrateObservation(baseRow({ contentHash: 'deadbeef' }), emptyMaps());
    expect(obs.rawContentHash).toBe('deadbeef');
    expect(obs.renderedContentHash).toBeNull();
  });

  it('schemaErrors null when empty, array when populated', () => {
    expect(hydrateObservation(baseRow({ schemaErrors: [] }), emptyMaps()).schemaErrors).toBeNull();
    const withErrors = hydrateObservation(baseRow({ schemaErrors: ['invalid JSON-LD block'] }), emptyMaps());
    expect(withErrors.schemaErrors).toEqual(['invalid JSON-LD block']);
  });

  it('schemaTypes come from structuredData jsonb array', () => {
    const obs = hydrateObservation(baseRow({ structuredData: ['Product', 'Offer'] }), emptyMaps());
    expect(obs.schemaTypes).toEqual(['Product', 'Offer']);
    expect(obs.hasProductPriceSchema).toBe(true);
    expect(obs.hasArticleDateSchema).toBe(false);
  });

  it('non-array structuredData degrades to empty array (defensive)', () => {
    const obs = hydrateObservation(baseRow({ structuredData: null }), emptyMaps());
    expect(obs.schemaTypes).toEqual([]);
  });

  it('hreflangEntries flows through and hreflangHasXDefault is computed', () => {
    const row = baseRow({
      hreflangEntries: [
        { hreflang: 'en', href: 'https://x.com/en', hrefIsAbsolute: true, langIsValid: true },
        { hreflang: 'x-default', href: 'https://x.com/', hrefIsAbsolute: true, langIsValid: true },
      ],
    });
    const obs = hydrateObservation(row, emptyMaps());
    expect(obs.hreflangTags).toHaveLength(2);
    expect(obs.hreflangHasXDefault).toBe(true);
  });
});

describe('hydrateObservation — cross-reference maps', () => {
  it('duplicateOfUrl pulled from the dup map', () => {
    const maps = emptyMaps();
    maps.duplicateOfByUrl.set('https://example.com/dup', 'https://example.com/canonical');
    const obs = hydrateObservation(baseRow({ url: 'https://example.com/dup' }), maps);
    expect(obs.duplicateOfUrl).toBe('https://example.com/canonical');
  });

  it('outboundLinks + internal count hydrated from outboundBySourceHash', () => {
    const maps = emptyMaps();
    const url = 'https://example.com/';
    maps.outboundBySourceHash.set(hashUrl(url), [
      { href: 'https://example.com/a', anchor: 'A', isInternal: true, relValues: [], statusCode: 200 },
      { href: 'https://external.com', anchor: 'E', isInternal: false, relValues: ['nofollow'], statusCode: null },
    ]);
    const obs = hydrateObservation(baseRow({ url }), maps);
    expect(obs.outboundLinks).toHaveLength(2);
    expect(obs.outboundInternalLinkCount).toBe(1);
  });

  it('inboundInternalLinkCount defaults to 0 (not null) for untracked targets', () => {
    const obs = hydrateObservation(baseRow(), emptyMaps());
    expect(obs.inboundInternalLinkCount).toBe(0);
  });

  it('inSitemap: true when listed, false when a sitemap exists but URL absent, null when no sitemap', () => {
    const noSitemap = hydrateObservation(baseRow(), emptyMaps());
    expect(noSitemap.inSitemap).toBeNull();

    const sitemapHit = emptyMaps();
    sitemapHit.sitemapByUrl.set('https://example.com/', { lastmod: null });
    expect(hydrateObservation(baseRow(), sitemapHit).inSitemap).toBe(true);

    const sitemapMiss = emptyMaps();
    sitemapMiss.sitemapByUrl.set('https://example.com/other', { lastmod: null });
    expect(hydrateObservation(baseRow(), sitemapMiss).inSitemap).toBe(false);
  });

  it('sitemapLastmodAge computed in whole days from maps.nowMs', () => {
    const now = new Date('2026-10-25T12:00:00Z');
    const maps = emptyMaps(now.getTime());
    const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);
    maps.sitemapByUrl.set('https://example.com/', { lastmod: tenDaysAgo });
    const obs = hydrateObservation(baseRow(), maps);
    expect(obs.sitemapLastmodAge).toBe(10);
  });

  it('sitemapLastmodAge null when sitemap entry has no lastmod', () => {
    const maps = emptyMaps();
    maps.sitemapByUrl.set('https://example.com/', { lastmod: null });
    expect(hydrateObservation(baseRow(), maps).sitemapLastmodAge).toBeNull();
  });

  it('isPriority is true when URL hash is a seed', () => {
    const maps = emptyMaps();
    maps.seedUrlHashes.add(hashUrl('https://example.com/'));
    expect(hydrateObservation(baseRow(), maps).isPriority).toBe(true);
  });

  it('isPriority is true when URL has GSC clicks > 0', () => {
    const maps = emptyMaps();
    maps.clicksByUrl.set('https://example.com/', 42);
    expect(hydrateObservation(baseRow(), maps).isPriority).toBe(true);
  });

  it('isPriority is false for pages with 0 clicks and no seed match', () => {
    const maps = emptyMaps();
    maps.clicksByUrl.set('https://example.com/', 0);
    expect(hydrateObservation(baseRow(), maps).isPriority).toBe(false);
  });

  it('hreflangMissingReturn flags locales from the missing map', () => {
    const maps = emptyMaps();
    maps.hreflangMissingByUrl.set('https://example.com/', ['de', 'fr']);
    const obs = hydrateObservation(baseRow(), maps);
    expect(obs.hreflangMissingReturn).toBe(true);
    expect(obs.hreflangMissingReturnLocales).toEqual(['de', 'fr']);
  });

  it('CrUX ratings and Lighthouse score flow from the maps', () => {
    const maps = emptyMaps();
    maps.originCruxLcp = { p75: 1200, rating: 'good' };
    maps.originCruxInp = { p75: 150, rating: 'good' };
    maps.originCruxCls = { p75: 0.05, rating: 'good' };
    maps.lhScoreByUrl.set('https://example.com/', 78);
    const obs = hydrateObservation(baseRow(), maps);
    expect(obs.cruxLcp).toEqual({ p75: 1200, rating: 'good' });
    expect(obs.cruxInp).toEqual({ p75: 150, rating: 'good' });
    expect(obs.cruxCls).toEqual({ p75: 0.05, rating: 'good' });
    expect(obs.lighthousePerformanceScore).toBe(78);
  });
});

describe('hydrateObservation — regression guard against snake_case access', () => {
  it('passes a camelized row (the shape the DAL actually produces, not snake_case)', () => {
    const row = baseRow({
      httpStatus: 404,
      finalUrl: 'https://example.com/moved',
      metaDescription: 'This should flow through',
    });

    const obs = hydrateObservation(row, emptyMaps());

    // If anyone regresses to reading row.http_status instead of row.httpStatus,
    // these assertions fail because the DAL doesn't produce snake_case keys.
    expect(obs.httpStatus).not.toBeUndefined();
    expect(obs.httpStatus).toBe(404);
    expect(obs.finalUrl).toBe('https://example.com/moved');
    expect(obs.metaDescription).toBe('This should flow through');
  });
});
