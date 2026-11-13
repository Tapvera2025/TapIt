import { createHash } from 'node:crypto';
import type { PageObservation, OutboundLink, PageImage, HreflangTag } from './rules/index.js';
import type { FetchResult } from './http.js';
import { hostKey, normalizeUrl } from '../url.js';

export interface ParseInput {
  /** The site's address. Used for internal-link detection when `siteHosts` is not given. */
  siteOrigin?: string;
  /** Host keys (lower case, no `www.`) that belong to this website. */
  siteHosts?: ReadonlySet<string>;
  fetch: FetchResult;
  /** The URL this page is recorded under. Defaults to the normalized final URL. */
  url?: string;
}

/** Links stored per page. Pages with more are rare and the counts stay meaningful. */
const MAX_LINKS = 2000;
const MAX_IMAGES = 500;

/** An attribute list that may contain `>` inside quoted values. */
const ATTRS = String.raw`((?:[^>"']|"[^"]*"|'[^']*')*)`;

/**
 * Extracts the signals rules evaluate from an HTML document.
 *
 * Deliberately dependency-free: a tolerant tag/attribute tokenizer rather than
 * a DOM. It handles the cases that broke the earlier regex version — quotes
 * inside attribute values (`content="We're…"`), `>` inside attributes,
 * commented-out markup, headings inside scripts or templates, `<base href>`,
 * empty tags — and degrades to nulls rather than throwing on malformed input.
 */
export function parseHtml(input: ParseInput): PageObservation {
  const { fetch } = input;
  const pageUrl = input.url ?? normalizeUrl(fetch.finalUrl) ?? fetch.finalUrl;
  const siteHosts =
    input.siteHosts ?? new Set(input.siteOrigin ? [safeHostKey(input.siteOrigin)].filter(isString) : []);

  const html = fetch.body.replace(/<!--[\s\S]*?-->/g, ' ');
  const head = extractHead(html);
  const base = baseHref(head, pageUrl);
  const body = extractBody(html);
  const visible = stripBlocks(body, ['script', 'style', 'noscript', 'template', 'svg']);
  const linkable = stripBlocks(body, ['script', 'style', 'template']);

  const titleMatch = head.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i);
  const title = titleMatch ? clean(collapse(decodeEntities(stripTags(titleMatch[1] ?? '')))) : null;

  let metaDescription: string | null = null;
  let metaRobots: string | null = null;
  for (const attrs of tags(head, 'meta')) {
    const name = attrs.get('name')?.toLowerCase();
    const content = clean((attrs.get('content') ?? '').trim());
    if (name === 'description' && metaDescription === null) metaDescription = content;
    else if (name === 'robots' && metaRobots === null) metaRobots = content;
  }

  let canonicalLink: string | null = null;
  const hreflangTags: HreflangTag[] = [];
  for (const attrs of tags(head, 'link')) {
    const rel = relTokens(attrs.get('rel'));
    const href = attrs.get('href');
    if (href === undefined) continue;
    if (rel.includes('canonical') && canonicalLink === null) {
      canonicalLink = normalizeUrl(href, base) ?? clean(href.trim());
    }
    const hreflang = attrs.get('hreflang');
    if (rel.includes('alternate') && hreflang !== undefined) {
      hreflangTags.push({
        hreflang: clean(hreflang.trim()),
        href: normalizeUrl(href, base) ?? clean(href.trim()),
        hrefIsAbsolute: /^https?:\/\//i.test(href.trim()),
        langIsValid: /^(x-default|[a-z]{2,3}(-[a-z]{4})?(-([a-z]{2}|\d{3}))?)$/i.test(hreflang.trim()),
      });
    }
  }

  const htmlTag = [...tags(html, 'html')][0];
  const lang = htmlTag?.get('lang')?.trim() || null;
  const linkHeader = fetch.headers['link'];
  const canonicalHeaderRaw = linkHeader ? parseCanonicalHeader(linkHeader) : null;
  const canonicalHeader = canonicalHeaderRaw === null ? null : normalizeUrl(canonicalHeaderRaw, pageUrl) ?? canonicalHeaderRaw;

  const h1Texts = Array.from(visible.matchAll(new RegExp(`<h1\\b${ATTRS}>([\\s\\S]*?)<\\/h1\\s*>`, 'gi')))
    .map((m) => clean(collapse(decodeEntities(stripTags(m[2] ?? '')))).slice(0, 500));
  const text = collapse(decodeEntities(stripTags(visible)));
  const words = text.split(/\s+/).filter(Boolean);
  const textHash = createHash('sha256').update(text.toLowerCase()).digest('hex');

  const outboundLinks = extractLinks(linkable, base, siteHosts);
  const images = extractImages(stripBlocks(body, ['script', 'style', 'noscript', 'template']), base);
  const structured = extractJsonLd(fetch.body);

  return {
    url: pageUrl,
    httpStatus: fetch.status,
    finalUrl: pageUrl,
    redirectChain: fetch.redirectChain.map((hop) => ({ url: hop.url, status: hop.status })),
    contentType: fetch.headers['content-type'] ?? null,

    title,
    metaDescription,
    metaRobots,
    canonicalLink,
    canonicalHeader,
    xRobotsTag: fetch.headers['x-robots-tag'] ?? null,
    lang: lang ? clean(lang) : null,

    h1Count: h1Texts.length,
    h1Text: h1Texts[0] ?? null,
    h1Texts,
    wordCount: words.length,
    contentHash: textHash,
    duplicateOfUrl: null,

    outboundLinks,
    outboundInternalLinkCount: outboundLinks.filter((l) => l.isInternal).length,
    inboundInternalLinkCount: null,

    images,

    inSitemap: null,
    sitemapLastmodAge: null,

    schemaErrors: structured.errors.length ? structured.errors : null,
    schemaTypes: structured.types.length ? structured.types : null,
    hasProductPriceSchema: !structured.productWithoutPrice,
    hasArticleDateSchema: !structured.articleWithoutDate,
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
    rawContentHash: textHash,
    renderedContentHash: null,
    rawSignals: null,
    contentLength: fetch.byteLength,
    responseTimeMs: fetch.elapsedMs,
  };
}

/** The signals a JavaScript render can change that matter for indexing. */
export function rawSignalsOf(obs: PageObservation) {
  return {
    title: obs.title,
    metaRobots: obs.metaRobots,
    canonicalLink: obs.canonicalLink,
    h1Count: obs.h1Count,
    wordCount: obs.wordCount,
  };
}

// ─── Document sections ───────────────────────────────────────────────────────

function extractHead(html: string): string {
  const m = html.match(/<head\b[^>]*>([\s\S]*?)<\/head\s*>/i);
  if (m) return m[1] ?? '';
  const bodyStart = html.search(/<body\b/i);
  return bodyStart >= 0 ? html.slice(0, bodyStart) : html.slice(0, 32_768);
}

function extractBody(html: string): string {
  const m = html.match(/<body\b[^>]*>([\s\S]*?)(?:<\/body\s*>|$)/i);
  return m?.[1] ?? html;
}

function stripBlocks(fragment: string, names: readonly string[]): string {
  let out = fragment;
  for (const name of names) {
    out = out.replace(new RegExp(`<${name}\\b[\\s\\S]*?<\\/${name}\\s*>`, 'gi'), ' ');
  }
  return out;
}

function baseHref(head: string, pageUrl: string): string {
  for (const attrs of tags(head, 'base')) {
    const href = attrs.get('href');
    if (href) return normalizeUrl(href, pageUrl) ?? pageUrl;
  }
  return pageUrl;
}

// ─── Tags and attributes ─────────────────────────────────────────────────────

function* tags(src: string, name: string): Generator<Map<string, string>> {
  const re = new RegExp(`<${name}\\b${ATTRS}\\/?>`, 'gi');
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) yield parseAttributes(m[1] ?? '');
}

/** Attribute names are lower-cased; values are entity-decoded. The first occurrence wins. */
export function parseAttributes(src: string): Map<string, string> {
  const attrs = new Map<string, string>();
  const re = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const name = m[1]!.toLowerCase();
    if (!attrs.has(name)) attrs.set(name, decodeEntities(m[2] ?? m[3] ?? m[4] ?? ''));
  }
  return attrs;
}

function relTokens(rel: string | undefined): string[] {
  return (rel ?? '').toLowerCase().split(/\s+/).filter(Boolean);
}

function parseCanonicalHeader(header: string): string | null {
  // Link: <https://example.com/>; rel="canonical", <…>; rel="alternate"
  for (const part of header.split(/,(?=\s*<)/)) {
    const m = part.match(/<([^>]+)>\s*;(.*)$/);
    if (m && /\brel\s*=\s*"?[^";]*\bcanonical\b/i.test(m[2] ?? '')) return m[1]!.trim();
  }
  return null;
}

function extractLinks(html: string, base: string, siteHosts: ReadonlySet<string>): OutboundLink[] {
  const links: OutboundLink[] = [];
  const re = new RegExp(`<a\\b${ATTRS}>([\\s\\S]*?)<\\/a\\s*>`, 'gi');
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null && links.length < MAX_LINKS) {
    const attrs = parseAttributes(m[1] ?? '');
    const raw = attrs.get('href')?.trim();
    if (!raw || raw.startsWith('#') || /^(mailto|tel|javascript|data|sms|ftp):/i.test(raw)) continue;
    const href = normalizeUrl(raw, base);
    if (!href) continue;
    const inner = m[2] ?? '';
    const imageAlt = [...tags(inner, 'img')][0]?.get('alt');
    const anchor =
      clean(collapse(decodeEntities(stripTags(inner)))) ||
      clean((imageAlt ?? attrs.get('aria-label') ?? attrs.get('title') ?? '').trim());
    const key = safeHostKey(href);
    links.push({
      href,
      anchor: anchor ? anchor.slice(0, 500) : null,
      isInternal: key !== null && siteHosts.has(key),
      relValues: relTokens(attrs.get('rel')),
      statusCode: null,
    });
  }
  return links;
}

function extractImages(html: string, base: string): PageImage[] {
  const images: PageImage[] = [];
  let likelyLcpChosen = false;
  for (const attrs of tags(html, 'img')) {
    if (images.length >= MAX_IMAGES) break;
    let src = attrs.get('src')?.trim() ?? '';
    const lazySrc = attrs.get('data-src') ?? attrs.get('data-lazy-src') ?? attrs.get('data-original');
    if ((!src || src.startsWith('data:')) && lazySrc) src = lazySrc.trim();
    if (!src) continue;
    const alt = attrs.has('alt') ? clean(attrs.get('alt') ?? '') : null;
    const role = attrs.get('role')?.toLowerCase();
    const isDecorative =
      alt === '' || role === 'presentation' || role === 'none' || attrs.get('aria-hidden') === 'true';
    const loading = attrs.get('loading')?.toLowerCase() ?? null;
    const width = Number.parseInt(attrs.get('width') ?? '', 10);
    const height = Number.parseInt(attrs.get('height') ?? '', 10);
    const tiny = Number.isFinite(width) && Number.isFinite(height) && width <= 100 && height <= 100;
    const iconish = /logo|icon|avatar|sprite|pixel|spacer|badge|emoji/i.test(
      `${src} ${alt ?? ''} ${attrs.get('class') ?? ''}`,
    );
    // The likely main image: the first meaningful raster image in the page body.
    // Lighthouse knows the real LCP element; this is the cheap, inferred stand-in.
    const isLikelyLCP =
      !likelyLcpChosen && !isDecorative && !tiny && !iconish && !src.startsWith('data:') && !/\.svg(\?|$)/i.test(src);
    if (isLikelyLCP) likelyLcpChosen = true;
    images.push({
      src: normalizeUrl(src, base) ?? clean(src).slice(0, 2048),
      alt,
      isDecorative,
      fileSizeBytes: null,
      loading,
      isLikelyLCP,
    });
  }
  return images;
}

const ARTICLE_TYPES = new Set(['Article', 'NewsArticle', 'BlogPosting', 'TechArticle', 'ScholarlyArticle', 'Report']);

function extractJsonLd(html: string): {
  types: string[];
  errors: string[];
  productWithoutPrice: boolean;
  articleWithoutDate: boolean;
} {
  const types: string[] = [];
  const errors: string[] = [];
  const state = { productWithoutPrice: false, articleWithoutDate: false };
  const re = new RegExp(`<script\\b${ATTRS}>([\\s\\S]*?)<\\/script\\s*>`, 'gi');
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const attrs = parseAttributes(m[1] ?? '');
    if ((attrs.get('type') ?? '').trim().toLowerCase() !== 'application/ld+json') continue;
    const raw = (m[2] ?? '')
      .replace(/^\s*(<!--|\/\/\s*<!\[CDATA\[|<!\[CDATA\[)/, '')
      .replace(/(-->|\/\/\s*\]\]>|\]\]>)\s*$/, '')
      .trim();
    if (!raw) continue;
    try {
      collect(JSON.parse(raw), types, state);
    } catch {
      errors.push('invalid JSON-LD block');
    }
  }
  return { types: Array.from(new Set(types)), errors, ...state };
}

function collect(
  node: unknown,
  out: string[],
  state: { productWithoutPrice: boolean; articleWithoutDate: boolean },
  depth = 0,
): void {
  if (!node || depth > 12) return;
  if (Array.isArray(node)) {
    for (const n of node) collect(n, out, state, depth + 1);
    return;
  }
  if (typeof node !== 'object') return;
  const obj = node as Record<string, unknown>;
  const t = obj['@type'];
  const nodeTypes = typeof t === 'string' ? [t] : Array.isArray(t) ? t.filter(isString) : [];
  out.push(...nodeTypes);
  if (nodeTypes.includes('Product') && !hasPrice(obj['offers'])) state.productWithoutPrice = true;
  if (nodeTypes.some((type) => ARTICLE_TYPES.has(type)) && !obj['datePublished']) state.articleWithoutDate = true;
  for (const key of ['@graph', 'mainEntity', 'itemListElement', 'hasPart']) {
    if (obj[key]) collect(obj[key], out, state, depth + 1);
  }
}

function hasPrice(offers: unknown): boolean {
  if (!offers) return false;
  if (Array.isArray(offers)) return offers.some(hasPrice);
  if (typeof offers !== 'object') return false;
  const o = offers as Record<string, unknown>;
  return (
    o['price'] !== undefined ||
    o['lowPrice'] !== undefined ||
    o['priceSpecification'] !== undefined ||
    hasPrice(o['offers'])
  );
}

// ─── Text utilities ──────────────────────────────────────────────────────────

function stripTags(fragment: string): string {
  return fragment.replace(/<[^>]*>/g, ' ');
}

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Postgres text cannot hold NUL. */
function clean(text: string): string {
  return text.replaceAll('\u0000', '');
}

const NAMED: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', copy: '©', reg: '®',
  trade: '™', hellip: '…', mdash: '—', ndash: '–', lsquo: '‘', rsquo: '’', ldquo: '“',
  rdquo: '”', laquo: '«', raquo: '»', bull: '•', middot: '·', deg: '°', euro: '€',
  pound: '£', yen: '¥', rupee: '₹', times: '×', divide: '÷', eacute: 'é', egrave: 'è',
  aacute: 'á', agrave: 'à', oacute: 'ó', uacute: 'ú', iacute: 'í', ntilde: 'ñ',
  ccedil: 'ç', auml: 'ä', ouml: 'ö', uuml: 'ü', szlig: 'ß',
};

export function decodeEntities(src: string): string {
  return src.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (whole, entity: string) => {
    if (entity[0] === '#') {
      const code = entity[1] === 'x' || entity[1] === 'X'
        ? Number.parseInt(entity.slice(2), 16)
        : Number.parseInt(entity.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return '';
      return String.fromCodePoint(code);
    }
    return NAMED[entity] ?? NAMED[entity.toLowerCase()] ?? whole;
  });
}

function safeHostKey(url: string): string | null {
  try {
    return hostKey(new URL(url).hostname);
  } catch {
    return null;
  }
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}
