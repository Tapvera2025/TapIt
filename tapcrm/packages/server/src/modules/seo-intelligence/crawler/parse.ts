import { createHash } from 'node:crypto';
import type { PageObservation, OutboundLink, PageImage, HreflangTag } from './rules/index.js';
import type { FetchResult } from './http.js';

export interface ParseInput {
  siteOrigin: string;
  fetch: FetchResult;
}

/**
 * Extracts the signals rules evaluate from a raw HTML response.
 * Intentionally uses targeted regex over a full DOM parser: SEO rules need head tags,
 * link tags, headings, img/a elements — all of which have reliable string shapes in
 * well-formed HTML. For malformed inputs the parser degrades to nulls rather than throwing.
 */
export function parseHtml(input: ParseInput): PageObservation {
  const { fetch, siteOrigin } = input;
  const html = fetch.body;
  const siteHost = safeHost(siteOrigin);
  const finalHost = safeHost(fetch.finalUrl);

  const headRaw = extractHead(html);
  const bodyRaw = stripScriptStyle(extractBody(html));

  const title = firstMatch(headRaw, /<title[^>]*>([\s\S]*?)<\/title>/i);
  const metaDescription = firstMetaContent(headRaw, 'description');
  const metaRobots = firstMetaContent(headRaw, 'robots');
  const canonicalLink = firstLinkHref(headRaw, 'canonical');
  const lang = firstMatch(html, /<html\b[^>]*\blang=["']([^"']+)["']/i);
  const canonicalHeader = fetch.headers['link'] ? parseCanonicalHeader(fetch.headers['link']) : null;
  const xRobotsTag = fetch.headers['x-robots-tag'] ?? null;

  const h1Matches = Array.from(html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi));
  const h1Texts = h1Matches.map((m) => textContent(m[1] ?? ''));
  const h1Count = h1Matches.length;
  const h1Text = h1Texts[0] ?? null;

  const words = textContent(bodyRaw).split(/\s+/).filter(Boolean);
  const wordCount = words.length;

  const outboundLinks = extractLinks(html, fetch.finalUrl, siteHost);
  const outboundInternalLinkCount = outboundLinks.filter((l) => l.isInternal).length;

  const images = extractImages(html);
  const hreflangTags = extractHreflang(headRaw);
  const structured = extractJsonLd(html);

  const contentHash = createHash('sha256').update(fetch.body).digest('hex');

  const observation: PageObservation = {
    url: fetch.finalUrl,
    httpStatus: fetch.status,
    finalUrl: fetch.finalUrl,
    redirectChain: fetch.redirectChain.map((hop) => ({ url: hop.url, status: hop.status })),
    contentType: fetch.headers['content-type'] ?? null,

    title: title ? decodeEntities(title.trim()) : null,
    metaDescription: metaDescription ? decodeEntities(metaDescription) : null,
    metaRobots,
    canonicalLink: canonicalLink ? absoluteUrl(canonicalLink, fetch.finalUrl) : null,
    canonicalHeader,
    xRobotsTag,
    lang,

    h1Count,
    h1Text,
    wordCount,
    contentHash,
    duplicateOfUrl: null,

    outboundLinks,
    outboundInternalLinkCount,
    inboundInternalLinkCount: null,

    images,

    inSitemap: null,
    sitemapLastmodAge: null,

    schemaErrors: structured.errors.length ? structured.errors : null,
    schemaTypes: structured.types.length ? structured.types : null,
    hasProductPriceSchema: structured.types.includes('Product') || structured.types.includes('Offer'),
    hasArticleDateSchema: structured.types.includes('Article') || structured.types.includes('NewsArticle'),
    schemaMismatch: null,

    hreflangTags,
    hreflangHasXDefault: hreflangTags.some((t) => t.hreflang.toLowerCase() === 'x-default'),
    hreflangMissingReturn: false,
    hreflangMissingReturnLocales: null,

    cruxLcp: null,
    cruxInp: null,
    cruxCls: null,

    lighthousePerformanceScore: null,

    isPriority: false,
    renderMode: 'raw',
    rawContentHash: contentHash,
    renderedContentHash: null,
    contentLength: fetch.byteLength,
    responseTimeMs: fetch.elapsedMs,
  };

  void finalHost;
  return observation;
}

// ─── Section extractors ──────────────────────────────────────────────────────

function extractHead(html: string): string {
  const m = html.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i);
  return m?.[1] ?? html.slice(0, 32_768);
}

function extractBody(html: string): string {
  const m = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  return m?.[1] ?? html;
}

function stripScriptStyle(fragment: string): string {
  return fragment
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, ' ');
}

// ─── Tag-level extractors ────────────────────────────────────────────────────

function firstMatch(src: string, re: RegExp): string | null {
  const m = src.match(re);
  return m?.[1] ?? null;
}

function firstMetaContent(head: string, name: string): string | null {
  const re = new RegExp(
    `<meta\\b[^>]*\\bname=["']${name}["'][^>]*\\bcontent=["']([^"']*)["']`,
    'i',
  );
  const alt = new RegExp(
    `<meta\\b[^>]*\\bcontent=["']([^"']*)["'][^>]*\\bname=["']${name}["']`,
    'i',
  );
  return firstMatch(head, re) ?? firstMatch(head, alt);
}

function firstLinkHref(head: string, rel: string): string | null {
  const re = new RegExp(
    `<link\\b[^>]*\\brel=["']${rel}["'][^>]*\\bhref=["']([^"']*)["']`,
    'i',
  );
  const alt = new RegExp(
    `<link\\b[^>]*\\bhref=["']([^"']*)["'][^>]*\\brel=["']${rel}["']`,
    'i',
  );
  return firstMatch(head, re) ?? firstMatch(head, alt);
}

function parseCanonicalHeader(header: string): string | null {
  // Link: <https://example.com/>; rel="canonical"
  const m = header.match(/<([^>]+)>\s*;\s*rel=["']?canonical["']?/i);
  return m?.[1] ?? null;
}

function extractLinks(html: string, pageUrl: string, siteHost: string | null): OutboundLink[] {
  const links: OutboundLink[] = [];
  const re = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const attrs = m[1] ?? '';
    const inner = m[2] ?? '';
    const hrefMatch = attrs.match(/\bhref=["']([^"']+)["']/i);
    if (!hrefMatch) continue;
    const href = hrefMatch[1]!;
    if (href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) continue;
    const absolute = absoluteUrl(href, pageUrl);
    if (!absolute) continue;
    const targetHost = safeHost(absolute);
    const relMatch = attrs.match(/\brel=["']([^"']+)["']/i);
    const relValues = relMatch ? relMatch[1]!.split(/\s+/).filter(Boolean) : [];
    links.push({
      href: absolute,
      anchor: decodeEntities(textContent(inner).trim()) || null,
      isInternal: siteHost !== null && targetHost === siteHost,
      relValues,
      statusCode: null,
    });
  }
  return links;
}

function extractImages(html: string): PageImage[] {
  const images: PageImage[] = [];
  const re = /<img\b([^>]*)>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const attrs = m[1] ?? '';
    const srcMatch = attrs.match(/\bsrc=["']([^"']+)["']/i);
    if (!srcMatch) continue;
    const altMatch = attrs.match(/\balt=["']([^"']*)["']/i);
    const roleMatch = attrs.match(/\brole=["']([^"']+)["']/i);
    const loadingMatch = attrs.match(/\bloading=["']([^"']+)["']/i);
    images.push({
      src: srcMatch[1]!,
      alt: altMatch ? altMatch[1]! : null,
      isDecorative: (altMatch && altMatch[1] === '') || roleMatch?.[1]?.toLowerCase() === 'presentation',
      fileSizeBytes: null,
      loading: loadingMatch?.[1] ?? null,
      isLikelyLCP: false,
    });
  }
  return images;
}

function extractHreflang(head: string): HreflangTag[] {
  const tags: HreflangTag[] = [];
  const re = /<link\b([^>]*)>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(head)) !== null) {
    const attrs = m[1] ?? '';
    if (!/\brel=["']alternate["']/i.test(attrs)) continue;
    const hreflangMatch = attrs.match(/\bhreflang=["']([^"']+)["']/i);
    if (!hreflangMatch) continue;
    const hrefMatch = attrs.match(/\bhref=["']([^"']+)["']/i);
    const href = hrefMatch?.[1] ?? '';
    const hreflang = hreflangMatch[1]!;
    tags.push({
      hreflang,
      href,
      hrefIsAbsolute: /^https?:\/\//i.test(href),
      langIsValid: /^(x-default|[a-z]{2}(-[A-Z]{2})?)$/i.test(hreflang),
    });
  }
  return tags;
}

function extractJsonLd(html: string): { types: string[]; errors: string[] } {
  const types: string[] = [];
  const errors: string[] = [];
  const re = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const raw = (m[1] ?? '').trim();
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      collectTypes(parsed, types);
    } catch {
      errors.push('invalid JSON-LD block');
    }
  }
  return { types: Array.from(new Set(types)), errors };
}

function collectTypes(node: unknown, out: string[]): void {
  if (!node) return;
  if (Array.isArray(node)) {
    node.forEach((n) => collectTypes(n, out));
    return;
  }
  if (typeof node !== 'object') return;
  const obj = node as Record<string, unknown>;
  const t = obj['@type'];
  if (typeof t === 'string') out.push(t);
  else if (Array.isArray(t)) t.forEach((x) => { if (typeof x === 'string') out.push(x); });
  const graph = obj['@graph'];
  if (Array.isArray(graph)) graph.forEach((g) => collectTypes(g, out));
}

// ─── Utilities ───────────────────────────────────────────────────────────────

function textContent(fragment: string): string {
  return fragment.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function decodeEntities(src: string): string {
  return src
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(parseInt(code as string, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code as string, 16)));
}

function absoluteUrl(href: string, base: string): string | null {
  try { return new URL(href, base).toString(); } catch { return null; }
}

function safeHost(url: string): string | null {
  try { return new URL(url).hostname.toLowerCase(); } catch { return null; }
}
