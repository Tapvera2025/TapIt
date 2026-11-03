/**
 * Parser tests. The fetch path is mocked via vi.mock so we exercise the pure
 * extraction logic without hitting the network.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const safeFetchMock = vi.fn();
vi.mock('./http.js', () => ({
  safeFetch: (...args: unknown[]) => safeFetchMock(...args),
  FetchError: class FetchError extends Error {},
  FetchTimeoutError: class FetchTimeoutError extends Error {},
  RedirectLoopError: class RedirectLoopError extends Error {},
}));

// Import AFTER the mock is registered so the module picks up the mocked safeFetch.
const { fetchSitemap, discoverSitemapUrl } = await import('./sitemap.js');

function respond(body: string, status = 200) {
  return {
    finalUrl: 'https://example.com/sitemap.xml',
    status, headers: {}, body, byteLength: body.length,
    truncated: false, elapsedMs: 10, redirectChain: [],
  };
}

beforeEach(() => safeFetchMock.mockReset());

describe('fetchSitemap — URL set parsing', () => {
  it('extracts URL + lastmod + priority + changefreq from <url> blocks', async () => {
    const body = `<?xml version="1.0"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://example.com/</loc>
    <lastmod>2026-01-01</lastmod>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>https://example.com/about</loc>
    <lastmod>2025-12-15</lastmod>
  </url>
</urlset>`;
    safeFetchMock.mockResolvedValueOnce(respond(body));
    const { entries } = await fetchSitemap('https://example.com/sitemap.xml');
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      url: 'https://example.com/',
      lastmod: '2026-01-01',
      changefreq: 'daily',
      priority: 1.0,
    });
    expect(entries[1]!.priority).toBeNull();
    expect(entries[1]!.changefreq).toBeNull();
  });

  it('decodes XML entities in URLs', async () => {
    const body = `<?xml version="1.0"?>
<urlset><url><loc>https://example.com/path?a=1&amp;b=2</loc></url></urlset>`;
    safeFetchMock.mockResolvedValueOnce(respond(body));
    const { entries } = await fetchSitemap('https://example.com/sitemap.xml');
    expect(entries[0]!.url).toBe('https://example.com/path?a=1&b=2');
  });

  it('returns empty entries for a non-200 response', async () => {
    safeFetchMock.mockResolvedValueOnce(respond('<html>not found</html>', 404));
    const { entries } = await fetchSitemap('https://example.com/sitemap.xml');
    expect(entries).toEqual([]);
  });

  it('returns empty entries on fetch error (does not throw)', async () => {
    safeFetchMock.mockRejectedValueOnce(new Error('network down'));
    const { entries } = await fetchSitemap('https://example.com/sitemap.xml');
    expect(entries).toEqual([]);
  });

  it('skips malformed <url> blocks (missing <loc>)', async () => {
    const body = `<urlset>
      <url><lastmod>2026-01-01</lastmod></url>
      <url><loc>https://example.com/ok</loc></url>
    </urlset>`;
    safeFetchMock.mockResolvedValueOnce(respond(body));
    const { entries } = await fetchSitemap('https://example.com/sitemap.xml');
    expect(entries).toHaveLength(1);
    expect(entries[0]!.url).toBe('https://example.com/ok');
  });

  it('follows a sitemap index one level deep', async () => {
    const index = `<?xml version="1.0"?>
<sitemapindex>
  <sitemap><loc>https://example.com/sitemap-blog.xml</loc></sitemap>
  <sitemap><loc>https://example.com/sitemap-pages.xml</loc></sitemap>
</sitemapindex>`;
    const blog = `<urlset><url><loc>https://example.com/post-1</loc></url></urlset>`;
    const pages = `<urlset><url><loc>https://example.com/about</loc></url></urlset>`;
    safeFetchMock
      .mockResolvedValueOnce(respond(index))
      .mockResolvedValueOnce(respond(blog))
      .mockResolvedValueOnce(respond(pages));
    const { entries, sitemapsVisited } = await fetchSitemap('https://example.com/sitemap_index.xml');
    expect(entries).toHaveLength(2);
    expect(sitemapsVisited).toHaveLength(3);
  });
});

describe('discoverSitemapUrl', () => {
  it('returns the Sitemap: directive from robots.txt when present', async () => {
    const robots = 'User-agent: *\nDisallow: /admin/\nSitemap: https://example.com/sitemap-main.xml';
    safeFetchMock.mockResolvedValueOnce(respond(robots));
    const url = await discoverSitemapUrl('https://example.com');
    expect(url).toBe('https://example.com/sitemap-main.xml');
  });

  it('falls back to /sitemap.xml when robots.txt lacks a Sitemap directive', async () => {
    const robots = 'User-agent: *\nDisallow: /admin/';
    safeFetchMock.mockResolvedValueOnce(respond(robots));
    const url = await discoverSitemapUrl('https://example.com');
    expect(url).toBe('https://example.com/sitemap.xml');
  });

  it('falls back to /sitemap.xml when robots.txt fetch fails', async () => {
    safeFetchMock.mockRejectedValueOnce(new Error('nope'));
    const url = await discoverSitemapUrl('https://example.com');
    expect(url).toBe('https://example.com/sitemap.xml');
  });
});
