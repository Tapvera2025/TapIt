import type { SeoSeverity, SeoConfidence } from '../../types.js';
import { isHtmlContentType } from '../../url.js';

export interface OutboundLink {
  href: string;
  anchor: string | null;
  isInternal: boolean;
  relValues: string[];
  statusCode: number | null;
}

export interface PageImage {
  src: string;
  alt: string | null | undefined;
  isDecorative: boolean;
  fileSizeBytes: number | null;
  loading: string | null;
  isLikelyLCP: boolean;
}

export interface HreflangTag {
  hreflang: string;
  href: string;
  hrefIsAbsolute: boolean;
  langIsValid: boolean;
}

/** What the raw HTML said before JavaScript ran, kept when a page is rendered. */
export interface RawSignals {
  title: string | null;
  metaRobots: string | null;
  canonicalLink: string | null;
  h1Count: number | null;
  wordCount: number | null;
}

export interface CwvRating {
  p75: number;
  rating: 'good' | 'needs_improvement' | 'poor';
}

/** The normalized observation a rule receives. */
export interface PageObservation {
  url: string;
  httpStatus: number | null;
  finalUrl: string | null;
  redirectChain: Array<{ url: string; status: number }>;
  contentType: string | null;

  // Meta / head
  title: string | null;
  metaDescription: string | null;
  metaRobots: string | null;
  canonicalLink: string | null;
  canonicalHeader: string | null;
  xRobotsTag: string | null;
  lang: string | null;

  // Content
  h1Count: number | null;
  h1Text: string | null;
  h1Texts?: string[];
  wordCount: number | null;
  contentHash: string | null;
  duplicateOfUrl: string | null;

  // Links
  outboundLinks: OutboundLink[];
  outboundInternalLinkCount: number | null;
  inboundInternalLinkCount: number | null;

  // Images
  images: PageImage[];

  // Sitemap
  inSitemap: boolean | null;
  sitemapLastmodAge: number | null;

  // Structured data
  schemaErrors: string[] | null;
  schemaTypes: string[] | null;
  hasProductPriceSchema: boolean;
  hasArticleDateSchema: boolean;
  schemaMismatch: string | null;

  // Internationalisation
  hreflangTags: HreflangTag[];
  hreflangHasXDefault: boolean;
  hreflangMissingReturn: boolean;
  hreflangMissingReturnLocales: string[] | null;

  // Core Web Vitals (field data)
  cruxLcp: CwvRating | null;
  cruxInp: CwvRating | null;
  cruxCls: CwvRating | null;

  // Lighthouse (lab data)
  lighthousePerformanceScore: number | null;

  // Crawl control
  isPriority: boolean;
  renderMode: 'raw' | 'rendered' | 'both';
  rawContentHash: string | null;
  renderedContentHash: string | null;
  /** Set when the page was rendered: the raw-HTML values, for C008. */
  rawSignals: RawSignals | null;
  contentLength: number | null;
  responseTimeMs: number | null;
}

export interface RuleResult {
  ruleId: string;
  ruleVersion: string;
  result: 'pass' | 'fail' | 'review' | 'skipped' | 'unknown';
  severity: SeoSeverity;
  confidence: SeoConfidence;
  affectedTarget: string | null;
  evidence: Record<string, unknown>;
  proposedFix: string | null;
}

export type RuleEvaluator = (obs: PageObservation) => RuleResult;

export interface RuleDefinition {
  ruleId: string;
  ruleVersion: string;
  group: string;
  severity: SeoSeverity;
  active: boolean;
  tested: boolean;
  /**
   * 'html' (default): only for pages that loaded (2xx) as HTML — an error page,
   * a redirect or a PDF has no title or headings to judge. 'any': every URL.
   */
  appliesTo?: 'html' | 'any';
  /** 'site' rules run once per scan on the site's own observation, not per page. */
  scope?: 'page' | 'site';
  evaluate: RuleEvaluator;
}

const registry = new Map<string, RuleDefinition>();

export function registerRule(def: RuleDefinition): void {
  registry.set(def.ruleId, def);
}

export function getRule(ruleId: string): RuleDefinition | undefined {
  return registry.get(ruleId);
}

export function getActiveRules(): RuleDefinition[] {
  return [...registry.values()].filter((r) => r.active && r.tested);
}

export function getAllRules(): RuleDefinition[] {
  return [...registry.values()];
}

export function getActiveRuleCount(): number {
  return getActiveRules().length;
}

/** True for a page that loaded as HTML — the pages content rules can judge. */
export function isEvaluablePage(obs: Pick<PageObservation, 'httpStatus' | 'contentType'>): boolean {
  return obs.httpStatus !== null && obs.httpStatus >= 200 && obs.httpStatus < 300 && isHtmlContentType(obs.contentType);
}

/** Page-scope rules that apply to this observation. */
export function evaluateAll(obs: PageObservation): RuleResult[] {
  const page = isEvaluablePage(obs);
  return runRules(
    getActiveRules().filter((rule) => (rule.scope ?? 'page') === 'page' && (page || rule.appliesTo === 'any')),
    obs,
  );
}

/** Site-scope rules, run once per scan against the site's observation (origin field data). */
export function evaluateSiteRules(obs: PageObservation): RuleResult[] {
  return runRules(getActiveRules().filter((rule) => rule.scope === 'site'), obs);
}

function runRules(rules: RuleDefinition[], obs: PageObservation): RuleResult[] {
  return rules.map((rule) => {
    try {
      return rule.evaluate(obs);
    } catch {
      return {
        ruleId: rule.ruleId,
        ruleVersion: rule.ruleVersion,
        result: 'unknown',
        severity: rule.severity,
        confidence: 'unknown',
        affectedTarget: obs.url,
        evidence: { error: 'evaluation_threw' },
        proposedFix: null,
      };
    }
  });
}

// Each rule module exports its definitions as data (no top-level registerRule call), so
// loading order is one-directional and the ES-module hoist cycle is avoided.
import { META_RULES } from './meta.js';
import { HTTP_RULES } from './http.js';
import { ROBOTS_RULES } from './robots.js';
import { CANONICALIZATION_RULES } from './canonicalization.js';
import { CONTENT_RULES } from './content.js';
import { LINKS_RULES } from './links.js';
import { IMAGES_RULES } from './images.js';
import { SITEMAPS_RULES } from './sitemaps.js';
import { SCHEMA_RULES } from './schema.js';
import { INTERNATIONAL_RULES } from './international.js';
import { PERFORMANCE_RULES } from './performance.js';

for (const rule of [
  ...META_RULES,
  ...HTTP_RULES,
  ...ROBOTS_RULES,
  ...CANONICALIZATION_RULES,
  ...CONTENT_RULES,
  ...LINKS_RULES,
  ...IMAGES_RULES,
  ...SITEMAPS_RULES,
  ...SCHEMA_RULES,
  ...INTERNATIONAL_RULES,
  ...PERFORMANCE_RULES,
]) registerRule(rule);
