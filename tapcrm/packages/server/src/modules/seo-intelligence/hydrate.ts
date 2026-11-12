import type { PageObservation, OutboundLink, PageImage, HreflangTag, CwvRating, RawSignals } from './crawler/rules/index.js';
import { hashUrl } from './url.js';

/**
 * The shape the DAL hands back after camelizing. These must stay in camelCase —
 * accessing snake_case fields on camelized rows silently yields `undefined`.
 */
export interface ObservationRow {
  id: string;
  url: string;
  httpStatus: number | null;
  finalUrl: string | null;
  title: string | null;
  metaDescription: string | null;
  metaRobots: string | null;
  canonicalLink: string | null;
  canonicalHeader: string | null;
  xRobotsTag: string | null;
  lang: string | null;
  h1Texts: string[];
  contentHash: string | null;
  contentType: string | null;
  contentLength: number | null;
  responseTimeMs: number | null;
  structuredData: unknown;
  hreflangEntries: unknown;
  redirectChain: unknown;
  wordCount: number | null;
  images: unknown;
  schemaErrors: string[];
  renderMode: 'raw' | 'rendered' | 'both';
  domHash: string | null;
  rawSignals?: unknown;
}

/** Pre-built cross-reference maps for one scan. Each map is populated by one SQL query. */
export interface HydrationMaps {
  outboundBySourceHash: Map<string, OutboundLink[]>;
  inboundInternalCountByTargetHash: Map<string, number>;
  sitemapByUrl: Map<string, { lastmod: Date | null }>;
  hreflangMissingByUrl: Map<string, string[]>;
  duplicateOfByUrl: Map<string, string>;
  clicksByUrl: Map<string, number>;
  lhScoreByUrl: Map<string, number>;
  seedUrlHashes: Set<string>;
  originCruxLcp: CwvRating | null;
  originCruxInp: CwvRating | null;
  originCruxCls: CwvRating | null;
  /** Timestamp "now" so caller controls deterministic lastmod-age math in tests. */
  nowMs: number;
}

/**
 * structured_data holds `{ types, productPrice, articleDate }`. Scans before the
 * parser fix stored a bare type array; those cannot say whether a price or date
 * was present, so they read as "present" and the D002/D003 checks stay quiet.
 */
function readStructuredData(value: unknown): { types: string[]; productPrice: boolean; articleDate: boolean } {
  if (Array.isArray(value)) return { types: value.filter((t): t is string => typeof t === 'string'), productPrice: true, articleDate: true };
  if (value && typeof value === 'object') {
    const v = value as { types?: unknown; productPrice?: unknown; articleDate?: unknown };
    return {
      types: Array.isArray(v.types) ? v.types.filter((t): t is string => typeof t === 'string') : [],
      productPrice: v.productPrice !== false,
      articleDate: v.articleDate !== false,
    };
  }
  return { types: [], productPrice: true, articleDate: true };
}

function readRawSignals(value: unknown): RawSignals | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Partial<RawSignals>;
  return {
    title: typeof v.title === 'string' ? v.title : null,
    metaRobots: typeof v.metaRobots === 'string' ? v.metaRobots : null,
    canonicalLink: typeof v.canonicalLink === 'string' ? v.canonicalLink : null,
    h1Count: typeof v.h1Count === 'number' ? v.h1Count : null,
    wordCount: typeof v.wordCount === 'number' ? v.wordCount : null,
  };
}

/**
 * Rebuilds a PageObservation from a camelized DB row plus the scan-wide cross-reference
 * maps. Pure: given the same inputs, returns the same observation. Export used by the
 * evaluate job AND by tests that guard against the snake_case/camelCase bug class.
 */
export function hydrateObservation(row: ObservationRow, maps: HydrationMaps): PageObservation {
  const structured = readStructuredData(row.structuredData);
  const schemaTypes = structured.types;
  const hreflangEntries = Array.isArray(row.hreflangEntries)
    ? (row.hreflangEntries as HreflangTag[]) : [];
  const redirectChain = Array.isArray(row.redirectChain)
    ? (row.redirectChain as Array<{ url: string; status: number }>) : [];
  const images = Array.isArray(row.images) ? (row.images as PageImage[]) : [];
  const outboundLinks = maps.outboundBySourceHash.get(hashUrl(row.url)) ?? [];

  const sitemapEntry = maps.sitemapByUrl.get(row.url);
  const sitemapLastmodAge = sitemapEntry?.lastmod
    ? Math.floor((maps.nowMs - sitemapEntry.lastmod.getTime()) / (24 * 60 * 60 * 1000))
    : null;

  return {
    url: row.url,
    httpStatus: row.httpStatus,
    finalUrl: row.finalUrl,
    redirectChain,
    contentType: row.contentType,

    title: row.title,
    metaDescription: row.metaDescription,
    metaRobots: row.metaRobots,
    canonicalLink: row.canonicalLink,
    canonicalHeader: row.canonicalHeader,
    xRobotsTag: row.xRobotsTag,
    lang: row.lang,

    h1Count: row.h1Texts.length,
    h1Text: row.h1Texts[0] ?? null,
    h1Texts: row.h1Texts,
    wordCount: row.wordCount,
    contentHash: row.contentHash,
    duplicateOfUrl: maps.duplicateOfByUrl.get(row.url) ?? null,

    outboundLinks,
    outboundInternalLinkCount: outboundLinks.filter((l) => l.isInternal).length,
    inboundInternalLinkCount: maps.inboundInternalCountByTargetHash.get(hashUrl(row.url)) ?? 0,

    images,

    inSitemap: maps.sitemapByUrl.has(row.url)
      ? true
      : (maps.sitemapByUrl.size > 0 ? false : null),
    sitemapLastmodAge,

    schemaErrors: row.schemaErrors.length > 0 ? row.schemaErrors : null,
    schemaTypes,
    hasProductPriceSchema: structured.productPrice,
    hasArticleDateSchema: structured.articleDate,
    schemaMismatch: null,

    hreflangTags: hreflangEntries,
    hreflangHasXDefault: hreflangEntries.some((t) => t.hreflang.toLowerCase() === 'x-default'),
    hreflangMissingReturn: (maps.hreflangMissingByUrl.get(row.url) ?? []).length > 0,
    hreflangMissingReturnLocales: maps.hreflangMissingByUrl.get(row.url) ?? null,

    cruxLcp: maps.originCruxLcp,
    cruxInp: maps.originCruxInp,
    cruxCls: maps.originCruxCls,

    lighthousePerformanceScore: maps.lhScoreByUrl.get(row.url) ?? null,

    isPriority: maps.seedUrlHashes.has(hashUrl(row.url)) || (maps.clicksByUrl.get(row.url) ?? 0) > 0,
    renderMode: row.renderMode,
    rawContentHash: row.contentHash,
    renderedContentHash: row.domHash,
    rawSignals: readRawSignals(row.rawSignals),
    contentLength: row.contentLength,
    responseTimeMs: row.responseTimeMs,
  };
}
