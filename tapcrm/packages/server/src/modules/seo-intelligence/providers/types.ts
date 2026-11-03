// Internal provider types — separate from the client-facing contracts types.

export type SeoProviderState = 'ok' | 'not_configured' | 'provider_error';

export interface SeoProvenance {
  source: string;
  retrievedAt: string;
  dataAsOf: string | null;
  confidence: 'direct' | 'estimated';
  isPaid: boolean;
}

export interface SeoProviderResult<T> {
  state: SeoProviderState;
  data: T | null;
  message?: string;
  provenance: SeoProvenance;
  coverage: number | null;
  usage: {
    provider: string;
    operation: string;
    units: number;
    unitType: string;
    costCents: number;
    elapsedMs: number;
  } | null;
}

export interface SerpSnapshot {
  engine: string;
  country: string;
  device: 'desktop' | 'mobile';
  query: string;
  organicRank: number | null;
  observedUrl: string | null;
  resultType: string | null;
  snapshotComplete: boolean;
}

export interface AIAnswerSnapshot {
  platform: string;
  locale: string;
  promptText: string;
  brandMentioned: boolean | null;
  domainCited: boolean | null;
  citationUrls: string[];
  competitorMentions: Array<{ domain: string; mentioned: boolean }>;
  rawAnswerRef: string | null;
}

export interface BacklinkPage {
  links: Array<{
    sourceUrl: string;
    sourceDomain: string;
    targetUrl: string;
    anchorText: string | null;
    relValues: string[];
    firstSeen: string | null;
    lastSeen: string;
    /** 0–100 provider authority score; null when the provider doesn't supply one. */
    domainAuthority: number | null;
  }>;
  cursor: string | null;
  totalEstimate: number | null;
}

export interface CruxMetrics {
  lcp: { p75: number; rating: 'good' | 'needs_improvement' | 'poor' } | null;
  inp: { p75: number; rating: 'good' | 'needs_improvement' | 'poor' } | null;
  cls: { p75: number; rating: 'good' | 'needs_improvement' | 'poor' } | null;
  fcp: { p75: number } | null;
  ttfb: { p75: number } | null;
  dataAvailable: boolean;
  collectionStart?: string | null;
  collectionEnd?: string | null;
}

export interface LighthouseReport {
  performanceScore: number | null;
  lcp: number | null;
  tbt: number | null;
  cls: number | null;
  fcp: number | null;
  si: number | null;
  runnerVersion: string;
  browserProfile: string;
  runAt: string;
}

export interface SearchRankProvider {
  observe(args: {
    query: string;
    targetDomain: string;
    market: string;
    language: string;
    device: 'desktop' | 'mobile';
    depth: number;
  }): Promise<SeoProviderResult<SerpSnapshot>>;
}

export interface AISearchProvider {
  observe(args: {
    prompt: string;
    platform: string;
    locale: string;
    language: string;
    brandAliases: string[];
    domain: string;
  }): Promise<SeoProviderResult<AIAnswerSnapshot>>;
}

export interface BacklinkProvider {
  getBacklinks(args: {
    domain: string;
    cursor?: string;
  }): Promise<SeoProviderResult<BacklinkPage>>;
}
