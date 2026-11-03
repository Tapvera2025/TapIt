import { describe, expect, it } from 'vitest';
import { parseHtml } from './parse.js';
import type { FetchResult } from './http.js';

function fakeFetch(body: string, overrides: Partial<FetchResult> = {}): FetchResult {
  return {
    finalUrl: 'https://example.com/',
    status: 200,
    headers: {},
    body,
    byteLength: body.length,
    truncated: false,
    elapsedMs: 100,
    redirectChain: [],
    ...overrides,
  };
}

describe('parseHtml', () => {
  it('extracts title, meta description, canonical, and lang from head', () => {
    const html = `
      <html lang="en-US">
        <head>
          <title>Welcome · Example</title>
          <meta name="description" content="Example home page" />
          <meta name="robots" content="index,follow" />
          <link rel="canonical" href="https://example.com/" />
        </head>
        <body><h1>Welcome</h1></body>
      </html>`;
    const obs = parseHtml({ siteOrigin: 'https://example.com', fetch: fakeFetch(html) });
    expect(obs.title).toBe('Welcome · Example');
    expect(obs.metaDescription).toBe('Example home page');
    expect(obs.metaRobots).toBe('index,follow');
    expect(obs.canonicalLink).toBe('https://example.com/');
    expect(obs.lang).toBe('en-US');
    expect(obs.h1Count).toBe(1);
    expect(obs.h1Text).toBe('Welcome');
  });

  it('decodes HTML entities in title and meta description', () => {
    const html = `<title>Tom &amp; Jerry&#39;s Café</title>
      <meta name="description" content="M&amp;M&#39;s snack" />`;
    const obs = parseHtml({ siteOrigin: 'https://example.com', fetch: fakeFetch(html) });
    expect(obs.title).toBe("Tom & Jerry's Café");
    expect(obs.metaDescription).toBe("M&M's snack");
  });

  it('counts multiple h1 elements', () => {
    const html = `<body><h1>One</h1><h1>Two</h1><h1>Three</h1></body>`;
    const obs = parseHtml({ siteOrigin: 'https://example.com', fetch: fakeFetch(html) });
    expect(obs.h1Count).toBe(3);
    expect(obs.h1Text).toBe('One');
  });

  it('returns null for missing head signals', () => {
    const html = `<html><body><p>No head tags.</p></body></html>`;
    const obs = parseHtml({ siteOrigin: 'https://example.com', fetch: fakeFetch(html) });
    expect(obs.title).toBeNull();
    expect(obs.metaDescription).toBeNull();
    expect(obs.canonicalLink).toBeNull();
    expect(obs.lang).toBeNull();
    expect(obs.h1Count).toBe(0);
    expect(obs.h1Text).toBeNull();
  });

  it('classifies links as internal vs external by hostname', () => {
    const html = `<body>
      <a href="/about">About</a>
      <a href="https://example.com/contact">Contact</a>
      <a href="https://other.com/page" rel="nofollow">External</a>
      <a href="mailto:hi@example.com">Email</a>
      <a href="#top">Jump</a>
    </body>`;
    const obs = parseHtml({ siteOrigin: 'https://example.com', fetch: fakeFetch(html) });
    expect(obs.outboundLinks).toHaveLength(3);
    expect(obs.outboundLinks[0]!.isInternal).toBe(true);
    expect(obs.outboundLinks[0]!.href).toBe('https://example.com/about');
    expect(obs.outboundLinks[1]!.isInternal).toBe(true);
    expect(obs.outboundLinks[2]!.isInternal).toBe(false);
    expect(obs.outboundLinks[2]!.relValues).toContain('nofollow');
    expect(obs.outboundInternalLinkCount).toBe(2);
  });

  it('extracts images and detects empty alt as decorative', () => {
    const html = `<body>
      <img src="/hero.jpg" alt="Hero banner" loading="lazy" />
      <img src="/divider.png" alt="" />
      <img src="/missing.png" />
      <img src="/role-presentation.jpg" role="presentation" />
    </body>`;
    const obs = parseHtml({ siteOrigin: 'https://example.com', fetch: fakeFetch(html) });
    expect(obs.images).toHaveLength(4);
    expect(obs.images[0]!.alt).toBe('Hero banner');
    expect(obs.images[0]!.loading).toBe('lazy');
    expect(obs.images[1]!.isDecorative).toBe(true);
    expect(obs.images[2]!.alt).toBeNull();
    expect(obs.images[3]!.isDecorative).toBe(true);
  });

  it('parses hreflang alternates including x-default', () => {
    const html = `<head>
      <link rel="alternate" hreflang="en" href="https://example.com/en" />
      <link rel="alternate" hreflang="de-DE" href="https://example.com/de" />
      <link rel="alternate" hreflang="x-default" href="https://example.com/" />
      <link rel="alternate" hreflang="bogus-locale!" href="/bad" />
    </head>`;
    const obs = parseHtml({ siteOrigin: 'https://example.com', fetch: fakeFetch(html) });
    expect(obs.hreflangTags).toHaveLength(4);
    expect(obs.hreflangHasXDefault).toBe(true);
    expect(obs.hreflangTags[0]!.langIsValid).toBe(true);
    expect(obs.hreflangTags[1]!.langIsValid).toBe(true);
    expect(obs.hreflangTags[3]!.langIsValid).toBe(false);
    expect(obs.hreflangTags[3]!.hrefIsAbsolute).toBe(false);
  });

  it('extracts JSON-LD @type values and reports parse errors', () => {
    const html = `
      <script type="application/ld+json">{ "@context": "https://schema.org", "@type": "Product", "name": "A" }</script>
      <script type="application/ld+json">{ "@type": ["Article", "NewsArticle"] }</script>
      <script type="application/ld+json">not valid json</script>`;
    const obs = parseHtml({ siteOrigin: 'https://example.com', fetch: fakeFetch(html) });
    expect(obs.schemaTypes).toContain('Product');
    expect(obs.schemaTypes).toContain('Article');
    expect(obs.schemaTypes).toContain('NewsArticle');
    expect(obs.hasProductPriceSchema).toBe(true);
    expect(obs.hasArticleDateSchema).toBe(true);
    expect(obs.schemaErrors).toEqual(['invalid JSON-LD block']);
  });

  it('reads canonical from Link header', () => {
    const html = `<html><body></body></html>`;
    const obs = parseHtml({
      siteOrigin: 'https://example.com',
      fetch: fakeFetch(html, {
        headers: { 'link': '<https://example.com/canonical>; rel="canonical"' },
      }),
    });
    expect(obs.canonicalHeader).toBe('https://example.com/canonical');
  });

  it('reads X-Robots-Tag from response headers', () => {
    const html = `<html><body></body></html>`;
    const obs = parseHtml({
      siteOrigin: 'https://example.com',
      fetch: fakeFetch(html, { headers: { 'x-robots-tag': 'noindex, nofollow' } }),
    });
    expect(obs.xRobotsTag).toBe('noindex, nofollow');
  });

  it('resolves canonical relative URL against final URL', () => {
    const html = `<head><link rel="canonical" href="/final-canonical" /></head>`;
    const obs = parseHtml({
      siteOrigin: 'https://example.com',
      fetch: fakeFetch(html, { finalUrl: 'https://example.com/some/path' }),
    });
    expect(obs.canonicalLink).toBe('https://example.com/final-canonical');
  });

  it('ignores script and style content when computing word count', () => {
    const html = `<body>
      <script>var secret = "do not count this";</script>
      <style>.x { color: red; }</style>
      <p>Only four visible words here</p>
    </body>`;
    const obs = parseHtml({ siteOrigin: 'https://example.com', fetch: fakeFetch(html) });
    expect(obs.wordCount).toBe(5);
  });

  it('fills contentHash and copies redirect chain + content_length', () => {
    const html = `<html></html>`;
    const obs = parseHtml({
      siteOrigin: 'https://example.com',
      fetch: fakeFetch(html, {
        byteLength: 42,
        elapsedMs: 123,
        redirectChain: [{ url: 'https://example.com/old', status: 301 }],
      }),
    });
    expect(obs.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(obs.rawContentHash).toBe(obs.contentHash);
    expect(obs.contentLength).toBe(42);
    expect(obs.responseTimeMs).toBe(123);
    expect(obs.redirectChain).toHaveLength(1);
    expect(obs.redirectChain[0]!.status).toBe(301);
  });
});
