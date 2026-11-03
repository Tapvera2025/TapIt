import { safeFetch } from './http.js';

export interface SitemapEntry {
  url: string;
  lastmod: string | null;
  changefreq: string | null;
  priority: number | null;
}

export interface SitemapFetchResult {
  entries: SitemapEntry[];
  sitemapsVisited: string[];
}

const MAX_INDEX_DEPTH = 2;
const MAX_ENTRIES = 50_000;

/**
 * Fetches a sitemap (or sitemap index) and returns a flat list of URL entries.
 * Follows sitemap-index indirection up to MAX_INDEX_DEPTH. Caps total entries at
 * MAX_ENTRIES so a malicious or runaway sitemap can't exhaust memory.
 *
 * Regex-based parsing — sitemaps have a well-defined narrow shape; the price is a
 * dependency-free parser that degrades on malformed input rather than throws.
 */
export async function fetchSitemap(url: string, depth = 0): Promise<SitemapFetchResult> {
  if (depth > MAX_INDEX_DEPTH) return { entries: [], sitemapsVisited: [] };

  let body: string;
  const visited: string[] = [url];
  try {
    const result = await safeFetch(url, { maxBytes: 10 * 1024 * 1024 });
    if (result.status !== 200) return { entries: [], sitemapsVisited: visited };
    body = result.body;
  } catch {
    return { entries: [], sitemapsVisited: visited };
  }

  // Sitemap index: <sitemapindex> containing <sitemap><loc>…</loc></sitemap>
  const isIndex = /<sitemapindex\b/i.test(body);
  if (isIndex) {
    const subs = extractLocs(body);
    const entries: SitemapEntry[] = [];
    for (const sub of subs) {
      if (entries.length >= MAX_ENTRIES) break;
      const nested = await fetchSitemap(sub, depth + 1);
      visited.push(...nested.sitemapsVisited);
      for (const e of nested.entries) {
        if (entries.length >= MAX_ENTRIES) break;
        entries.push(e);
      }
    }
    return { entries, sitemapsVisited: visited };
  }

  // Regular sitemap: <urlset> containing <url><loc>…</loc><lastmod>…</lastmod>…</url>
  return { entries: extractUrlEntries(body, MAX_ENTRIES), sitemapsVisited: visited };
}

/** Discovers the sitemap for a site. Tries robots.txt first, then falls back to /sitemap.xml. */
export async function discoverSitemapUrl(siteOrigin: string): Promise<string | null> {
  try {
    const robotsUrl = new URL('/robots.txt', siteOrigin).toString();
    const result = await safeFetch(robotsUrl, { maxBytes: 100 * 1024 });
    if (result.status === 200) {
      const match = result.body.match(/^\s*sitemap\s*:\s*(\S+)/im);
      if (match) return match[1]!;
    }
  } catch { /* fall through */ }

  try {
    return new URL('/sitemap.xml', siteOrigin).toString();
  } catch { return null; }
}

function extractLocs(xml: string): string[] {
  const out: string[] = [];
  const re = /<loc>\s*([^<]+?)\s*<\/loc>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const url = decodeEntities(m[1]!.trim());
    if (url) out.push(url);
  }
  return out;
}

function extractUrlEntries(xml: string, cap: number): SitemapEntry[] {
  const entries: SitemapEntry[] = [];
  const urlBlocks = xml.match(/<url\b[\s\S]*?<\/url>/gi) ?? [];
  for (const block of urlBlocks) {
    if (entries.length >= cap) break;
    const loc = block.match(/<loc>\s*([^<]+?)\s*<\/loc>/i)?.[1];
    if (!loc) continue;
    const lastmod = block.match(/<lastmod>\s*([^<]+?)\s*<\/lastmod>/i)?.[1] ?? null;
    const changefreq = block.match(/<changefreq>\s*([^<]+?)\s*<\/changefreq>/i)?.[1] ?? null;
    const priorityStr = block.match(/<priority>\s*([^<]+?)\s*<\/priority>/i)?.[1];
    const priority = priorityStr ? parseFloat(priorityStr) : null;
    entries.push({
      url: decodeEntities(loc.trim()),
      lastmod,
      changefreq,
      priority: priority !== null && !Number.isNaN(priority) ? priority : null,
    });
  }
  return entries;
}

function decodeEntities(src: string): string {
  return src
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}
