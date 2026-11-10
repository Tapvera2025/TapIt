import { describe, expect, it } from 'vitest';
import { parseHtml } from './crawler/parse.js';
import { evaluateAll, evaluateSiteRules, type PageObservation } from './crawler/rules/index.js';
import type { FetchResult } from './crawler/http.js';
import { findDuplicates, isExcluded, startUrl } from './crawl.js';
import { hostKey, inScope, isRelatedHost, isSiteUrl, normalizeUrl } from './url.js';

function fetchOf(body: string, overrides: Partial<FetchResult> = {}): FetchResult {
  return {
    finalUrl: 'https://example.com/page',
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
    body,
    byteLength: body.length,
    truncated: false,
    elapsedMs: 50,
    redirectChain: [],
    ...overrides,
  };
}

function page(body: string, overrides: Partial<FetchResult> = {}, extra: Partial<PageObservation> = {}): PageObservation {
  return { ...parseHtml({ siteOrigin: 'https://example.com', fetch: fetchOf(body, overrides) }), ...extra };
}

const ids = (results: ReturnType<typeof evaluateAll>) =>
  results.filter((r) => r.result === 'fail' || r.result === 'review').map((r) => r.ruleId).sort();

describe('URL identity', () => {
  it('normalizes once for every source', () => {
    expect(normalizeUrl('https://Example.com')).toBe('https://example.com/');
    expect(normalizeUrl('https://example.com:443/a?#x')).toBe('https://example.com/a');
    expect(normalizeUrl('/b', 'https://example.com/a/')).toBe('https://example.com/b');
    expect(normalizeUrl('mailto:hi@example.com')).toBeNull();
    expect(normalizeUrl('ftp://example.com/')).toBeNull();
  });

  it('treats www and the bare host as one site, and subdomains as related', () => {
    expect(hostKey('WWW.Acme.com')).toBe('acme.com');
    expect(isSiteUrl('http://www.acme.com/x', new Set(['acme.com']))).toBe(true);
    expect(isRelatedHost('acme.com', 'shop.acme.com')).toBe(true);
    expect(isRelatedHost('acme.com', 'acme.co.uk')).toBe(false);
  });

  it('starts from the site address plus its scope, and keeps the crawl inside the scope', () => {
    expect(startUrl({ displayUrl: 'https://acme.com', scopePath: '' })).toBe('https://acme.com/');
    expect(startUrl({ displayUrl: 'https://acme.com', scopePath: '/blog' })).toBe('https://acme.com/blog');
    expect(inScope('https://acme.com/blog/post', '/blog')).toBe(true);
    expect(inScope('https://acme.com/blogger', '/blog')).toBe(false);
    expect(isExcluded('https://acme.com/cart?x=1', ['/cart'])).toBe(true);
  });
});

describe('which checks run on which URLs', () => {
  it('an error page only gets the status finding, not title/heading/content findings', () => {
    const obs = page('<html><body>Not found</body></html>', { status: 404 });
    expect(ids(evaluateAll(obs))).toEqual(['H001']);
  });

  it('a PDF is judged on its status only', () => {
    const obs = page('', { headers: { 'content-type': 'application/pdf' }, bodySkipped: true });
    expect(ids(evaluateAll(obs))).toEqual([]);
  });

  it('a two-hop redirect is not a loop; a repeated URL is', () => {
    const base = page('', { status: 301 }, {
      url: 'http://example.com/a',
      finalUrl: 'https://www.example.com/a',
      contentType: null,
      redirectChain: [{ url: 'http://example.com/a', status: 301 }, { url: 'https://example.com/a', status: 301 }],
    });
    expect(ids(evaluateAll(base))).not.toContain('H009');
    const loop = { ...base, finalUrl: null, redirectChain: [{ url: 'https://example.com/a', status: 302 }, { url: 'https://example.com/b', status: 302 }, { url: 'https://example.com/a', status: 302 }] };
    expect(ids(evaluateAll(loop))).toContain('H009');
  });

  it('site-wide field data is judged once by the site rules, never per page', () => {
    const poor = { p75: 5200, rating: 'poor' as const };
    const obs = page('<html><head><title>T</title></head><body><h1>H</h1></body></html>', {}, { cruxLcp: poor });
    expect(ids(evaluateAll(obs))).not.toContain('P001');
    expect(ids(evaluateSiteRules({ ...obs, cruxLcp: poor }))).toContain('P001');
  });
});

describe('finding accuracy', () => {
  const words = Array.from({ length: 80 }, (_, i) => `w${i}`).join(' ');

  it('missing and empty titles are different findings', () => {
    expect(ids(evaluateAll(page(`<html><head></head><body><h1>H</h1><p>${words}</p></body></html>`)))).toContain('M001');
    const empty = ids(evaluateAll(page(`<html><head><title></title></head><body><h1>H</h1><p>${words}</p></body></html>`)));
    expect(empty).toContain('M002');
    expect(empty).not.toContain('M001');
  });

  it('multiple H1s are found again', () => {
    expect(ids(evaluateAll(page(`<html><head><title>T</title></head><body><h1>A</h1><h1>B</h1><p>${words}</p></body></html>`)))).toContain('T003');
  });

  it('a matching title and H1 is informational, not high priority', () => {
    const result = evaluateAll(page(`<html><head><title>Same</title></head><body><h1>Same</h1><p>${words}</p></body></html>`))
      .find((r) => r.ruleId === 'T004');
    expect(result).toMatchObject({ result: 'review', severity: 'informational' });
  });

  it('a lazy-loaded main image is flagged', () => {
    const html = `<html><head><title>T</title></head><body><h1>H</h1><img src="/hero.jpg" alt="Hero" loading="lazy"><p>${words}</p></body></html>`;
    expect(ids(evaluateAll(page(html)))).toContain('A005');
  });

  it('a priority page canonicalized elsewhere is not expected in the sitemap', () => {
    const html = `<html><head><title>T</title><link rel="canonical" href="https://example.com/other"></head><body><h1>H</h1><p>${words}</p></body></html>`;
    const obs = { ...page(html), isPriority: true, inSitemap: false };
    expect(ids(evaluateAll(obs))).not.toContain('S001');
    expect(ids(evaluateAll({ ...obs, canonicalLink: null }))).toContain('S001');
  });

  it('C008 flags JavaScript changing the robots directive, not ordinary rendering changes', () => {
    const rendered = page(`<html><head><title>T</title><meta name="robots" content="noindex"></head><body><h1>H</h1><p>${words}</p></body></html>`);
    const changed = { ...rendered, renderMode: 'both' as const, rawSignals: { title: 'T', metaRobots: null, canonicalLink: null, h1Count: 1, wordCount: 80 } };
    expect(ids(evaluateAll(changed))).toContain('C008');
    const same = { ...changed, metaRobots: null, rawSignals: { ...changed.rawSignals, title: 'Before JS' } };
    expect(ids(evaluateAll(same))).not.toContain('C008');
  });

  it('duplicates are self-canonical pages with the same text; canonicalized copies are fine', () => {
    const pages = [
      { url: 'https://example.com/a', contentHash: 'h', canonicalLink: null, evaluable: true },
      { url: 'https://example.com/a?ref=x', contentHash: 'h', canonicalLink: 'https://example.com/a', evaluable: true },
      { url: 'https://example.com/copy', contentHash: 'h', canonicalLink: 'https://example.com/copy', evaluable: true },
      { url: 'https://example.com/404', contentHash: 'h', canonicalLink: null, evaluable: false },
    ];
    expect([...findDuplicates(pages)]).toEqual([['https://example.com/copy', 'https://example.com/a']]);
  });
});
