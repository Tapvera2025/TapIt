import { identityRequest, identityDownload } from '../identity/api/authApi.js';
import type { SocialGoogleIndexInspection, SocialSearchConsolePerformance } from '../social/types.js';
import type {
  SeoSite,
  SeoScanRun,
  SeoFinding,
  SeoFindingGroup,
  SeoFindingsTrendPoint,
  SeoGscMetrics,
  SeoKeyword,
  SeoSerpObservation,
  SeoAiObservation,
  SeoBacklink,
  SeoCwvObservation,
  SeoFixProposal,
  SeoAlert,
  SeoRuleRow,
} from './types.js';

export interface SeoSiteInput {
  clientId?: string | null;
  displayUrl: string;
  timezone?: string;
  locale?: string;
  businessIntents?: string[];
  stackNotes?: string | null;
}

export interface SeoFindingPage {
  rows: SeoFinding[];
  total: number;
}

export interface SeoGscSyncResult {
  state: string;
  synced: number;
  propertyUrl?: string;
  rowLimitHit?: boolean;
  message?: string;
}

export interface SeoRankStatus {
  provider: string;
  configured: boolean;
  monthlyLimit: number;
  used: number;
  remaining: number;
  trackedKeywords: number;
}

export interface SeoPerformanceStatus {
  provider: 'crux' | 'pagespeed';
  configured: boolean;
  state: 'running' | 'ready' | 'no_data' | 'not_configured' | 'error' | 'not_run';
  message: string | null;
  updatedAt: string | null;
}
export const getSeoPerformanceStatus = (siteId: string) => identityRequest<SeoPerformanceStatus[]>(`/api/seo/sites/${encodeURIComponent(siteId)}/performance-status`);
export const refreshSeoPerformance = (siteId: string) => identityRequest<{ state: string }>(`/api/seo/sites/${encodeURIComponent(siteId)}/performance-refresh`, { method: 'POST' });

export const getSeoRankStatus = (siteId: string) => identityRequest<SeoRankStatus>(`/api/seo/sites/${encodeURIComponent(siteId)}/rank-status`);
export const checkSeoRanks = (siteId: string) => identityRequest<{ state: string; batchLimit: number }>(`/api/seo/sites/${encodeURIComponent(siteId)}/rank-checks`, { method: 'POST' });

// ─── Sites ────────────────────────────────────────────────────────────────────

export const listSeoSites = () =>
  identityRequest<SeoSite[]>('/api/seo/sites');

export const getSeoSite = (siteId: string) =>
  identityRequest<SeoSite>(`/api/seo/sites/${encodeURIComponent(siteId)}`);

export const createSeoSite = (input: SeoSiteInput) =>
  identityRequest<SeoSite>('/api/seo/sites', {
    method: 'POST',
    body: JSON.stringify(input),
  });

export const updateSeoSite = (
  siteId: string,
  patch: Partial<Pick<SeoSiteInput, 'timezone' | 'locale' | 'businessIntents' | 'stackNotes'>>,
) =>
  identityRequest<SeoSite>(`/api/seo/sites/${encodeURIComponent(siteId)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });

// ─── Scans ────────────────────────────────────────────────────────────────────

export const listSeoScans = (siteId: string) =>
  identityRequest<SeoScanRun[]>(`/api/seo/sites/${encodeURIComponent(siteId)}/scans`);

export const triggerSeoScan = (siteId: string) =>
  identityRequest<{ scanRunId: string }>(`/api/seo/sites/${encodeURIComponent(siteId)}/scans`, {
    method: 'POST',
    body: JSON.stringify({}),
  });

export const getSeoScan = (scanRunId: string) =>
  identityRequest<SeoScanRun>(`/api/seo/scans/${encodeURIComponent(scanRunId)}`);

// ─── Findings ─────────────────────────────────────────────────────────────────

export const listSeoFindings = (
  siteId: string,
  opts: { status?: string; severity?: string; limit?: number; offset?: number } = {},
) => {
  const params = new URLSearchParams();
  if (opts.status) params.set('status', opts.status);
  if (opts.severity) params.set('severity', opts.severity);
  if (opts.limit) params.set('limit', String(opts.limit));
  if (opts.offset) params.set('offset', String(opts.offset));
  const qs = params.toString();
  return identityRequest<SeoFindingPage>(
    `/api/seo/sites/${encodeURIComponent(siteId)}/findings${qs ? `?${qs}` : ''}`,
  );
};

export const getSeoFinding = (findingId: string) =>
  identityRequest<SeoFinding>(`/api/seo/findings/${encodeURIComponent(findingId)}`);

export const listSeoFindingGroups = (siteId: string) =>
  identityRequest<SeoFindingGroup[]>(`/api/seo/sites/${encodeURIComponent(siteId)}/finding-groups`);

export const getSeoFindingsTrend = (siteId: string, days = 30) =>
  identityRequest<SeoFindingsTrendPoint[]>(`/api/seo/sites/${encodeURIComponent(siteId)}/findings-trend?days=${days}`);

export const updateSeoFinding = (
  findingId: string,
  patch: { status?: string; assignedTo?: string | null },
) =>
  identityRequest<SeoFinding>(`/api/seo/findings/${encodeURIComponent(findingId)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });

// ─── Search Performance ───────────────────────────────────────────────────────

export const listGscMetrics = (
  siteId: string,
  startDate: string,
  endDate: string,
  limit = 1000,
) => {
  const params = new URLSearchParams({ startDate, endDate, limit: String(limit) });
  return identityRequest<SeoGscMetrics[]>(
    `/api/seo/sites/${encodeURIComponent(siteId)}/gsc-metrics?${params}`,
  );
};

export const syncGscData = (
  siteId: string,
  propertyUrl: string,
  startDate: string,
  endDate: string,
) =>
  identityRequest<SeoGscSyncResult>(
    `/api/seo/sites/${encodeURIComponent(siteId)}/gsc-sync`,
    {
      method: 'POST',
      body: JSON.stringify({ propertyUrl, startDate, endDate }),
    },
  );

// ─── Keywords ─────────────────────────────────────────────────────────────────

export const listSeoKeywords = (siteId: string) =>
  identityRequest<SeoKeyword[]>(`/api/seo/sites/${encodeURIComponent(siteId)}/keywords`);

export const updateSeoKeyword = (siteId: string, keywordId: string, patch: { tracked: boolean }) =>
  identityRequest<SeoKeyword>(
    `/api/seo/sites/${encodeURIComponent(siteId)}/keywords/${encodeURIComponent(keywordId)}`,
    { method: 'PATCH', body: JSON.stringify(patch) },
  );

// ─── Site settings ────────────────────────────────────────────────────────────

export type SeoRenderPolicy = 'never' | 'heuristic' | 'always';
export type SeoCrawlerIdentity = 'tapcrm' | 'browser';

export interface SeoCrawlSettings {
  maxPages: number;
  renderPolicy: SeoRenderPolicy;
  maxRenderPages: number;
  respectRobots: boolean;
  followSitemaps: boolean;
  crawlDelayMs: number;
  exclusionPatterns: string[];
  crawlerIdentity: SeoCrawlerIdentity;
}

export interface SeoAllowanceStatus {
  configured: boolean;
  monthlyLimit: number;
  used: number;
  remaining: number;
}

export interface SeoSiteSettings {
  crawl: SeoCrawlSettings;
  renderingAvailable: boolean;
  limits: {
    maxPages: { min: number; max: number };
    maxRenderPages: { min: number; max: number };
    crawlDelayMs: { min: number; max: number };
    exclusionPatterns: { max: number; length: number };
  };
  allowances: { serpSearches: SeoAllowanceStatus; perplexity: SeoAllowanceStatus; moz: SeoAllowanceStatus };
}

export interface SeoSiteSettingsPatch {
  crawl?: Partial<SeoCrawlSettings>;
  allowances?: { serpSearches?: number; perplexity?: number; moz?: number };
}

export const getSeoSiteSettings = (siteId: string) =>
  identityRequest<SeoSiteSettings>(`/api/seo/sites/${encodeURIComponent(siteId)}/settings`);

export const updateSeoSiteSettings = (siteId: string, patch: SeoSiteSettingsPatch) =>
  identityRequest<SeoSiteSettings>(`/api/seo/sites/${encodeURIComponent(siteId)}/settings`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });

// ─── Rank Tracking ────────────────────────────────────────────────────────────

export const listSeoSerpObservations = (siteId: string, opts: { limit?: number } = {}) => {
  const params = new URLSearchParams();
  if (opts.limit) params.set('limit', String(opts.limit));
  const qs = params.toString();
  return identityRequest<SeoSerpObservation[]>(
    `/api/seo/sites/${encodeURIComponent(siteId)}/serp-observations${qs ? `?${qs}` : ''}`,
  );
};

// ─── AI Visibility ────────────────────────────────────────────────────────────

export const listSeoAiObservations = (siteId: string, opts: { limit?: number } = {}) => {
  const params = new URLSearchParams();
  if (opts.limit) params.set('limit', String(opts.limit));
  const qs = params.toString();
  return identityRequest<SeoAiObservation[]>(
    `/api/seo/sites/${encodeURIComponent(siteId)}/ai-observations${qs ? `?${qs}` : ''}`,
  );
};

// ─── Backlinks ────────────────────────────────────────────────────────────────

export const listSeoBacklinks = (siteId: string, opts: { limit?: number } = {}) => {
  const params = new URLSearchParams();
  if (opts.limit) params.set('limit', String(opts.limit));
  const qs = params.toString();
  return identityRequest<SeoBacklink[]>(
    `/api/seo/sites/${encodeURIComponent(siteId)}/backlinks${qs ? `?${qs}` : ''}`,
  );
};

// ─── Core Web Vitals ──────────────────────────────────────────────────────────

export const listSeoCwvObservations = (siteId: string, opts: { limit?: number } = {}) => {
  const params = new URLSearchParams();
  if (opts.limit) params.set('limit', String(opts.limit));
  const qs = params.toString();
  return identityRequest<SeoCwvObservation[]>(
    `/api/seo/sites/${encodeURIComponent(siteId)}/cwv-observations${qs ? `?${qs}` : ''}`,
  );
};

// ─── Fix Proposals ────────────────────────────────────────────────────────────

export const listSeoFixProposals = (siteId: string, opts: { status?: string } = {}) => {
  const params = new URLSearchParams();
  if (opts.status) params.set('status', opts.status);
  const qs = params.toString();
  return identityRequest<SeoFixProposal[]>(
    `/api/seo/sites/${encodeURIComponent(siteId)}/fix-proposals${qs ? `?${qs}` : ''}`,
  );
};

export const updateSeoFixProposal = (
  proposalId: string,
  patch: { status: 'executed' | 'rejected' },
) =>
  identityRequest<SeoFixProposal>(`/api/seo/fix-proposals/${encodeURIComponent(proposalId)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });

// ─── Monitoring / Alerts ──────────────────────────────────────────────────────

export const listSeoAlerts = (siteId: string) =>
  identityRequest<SeoAlert[]>(`/api/seo/sites/${encodeURIComponent(siteId)}/alerts`);

export const acknowledgeSeoAlert = (alertId: string) =>
  identityRequest<SeoAlert>(`/api/seo/alerts/${encodeURIComponent(alertId)}`, {
    method: 'PATCH',
    body: JSON.stringify({}),
  });

/** Downloads a PDF SEO site report. Returns a Blob so callers can trigger a save. */
export const downloadSeoReport = (siteId: string): Promise<Blob> =>
  identityDownload(`/api/seo/sites/${encodeURIComponent(siteId)}/report`, { method: 'POST' });

// ─── Rules ────────────────────────────────────────────────────────────────────

export const listSeoRules = () =>
  identityRequest<SeoRuleRow[]>('/api/seo/rules');

export const updateSeoRule = (ruleId: string, patch: { active: boolean }) =>
  identityRequest<SeoRuleRow>(`/api/seo/rules/${encodeURIComponent(ruleId)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });

// ─── Keyword search: scan a website ──────────────────────────────────────────

export type SeoScanEngine = 'google' | 'bing' | 'google_local';
export interface SeoScanTopResult {
  position: number;
  url: string | null;
  title: string | null;
}
export interface SeoRankScan {
  id: string;
  keyword: string;
  engine: SeoScanEngine;
  country: string;
  city: string | null;
  searchLocation: string;
  device: 'desktop' | 'mobile';
  depth: number;
  status: 'found' | 'not-found' | 'failed';
  position: number | null;
  rankingUrl: string | null;
  rankingTitle: string | null;
  resultsChecked: number | null;
  pagesRequested: number;
  topResults: SeoScanTopResult[];
  message: string | null;
  requestedByName: string | null;
  createdAt: string;
}
export interface SeoRankScanInput {
  keyword: string;
  searchEngine: 'google' | 'bing';
  category: 'seo' | 'gmb';
  country: string;
  city?: string | null;
  device: 'desktop' | 'mobile';
  depth: 10 | 20 | 30 | 50 | 100;
}
export const listSeoRankScans = (siteId: string) =>
  identityRequest<SeoRankScan[]>(`/api/seo/sites/${encodeURIComponent(siteId)}/rank-scans`);
export const scanSeoRank = (siteId: string, input: SeoRankScanInput) =>
  identityRequest<{ scan: SeoRankScan; allowance: { monthlyLimit: number; used: number; remaining: number } }>(
    `/api/seo/sites/${encodeURIComponent(siteId)}/rank-scans`,
    { method: 'POST', body: JSON.stringify(input) },
  );

// ─── Google Search Console (moved from Social → Analytics) ───────────────────

export interface SeoSearchConsoleReport {
  website: string;
  property: {
    propertyUrl: string;
    permissionLevel: string;
    status: 'connected' | 'reconnect_required';
    account: string | null;
  } | null;
  problem: string | null;
  performance: SocialSearchConsolePerformance | null;
}
export const getSeoSearchConsoleReport = (siteId: string, range: { from: string; to: string }) =>
  identityRequest<SeoSearchConsoleReport>(
    `/api/seo/sites/${encodeURIComponent(siteId)}/search-console?${new URLSearchParams(range).toString()}`,
  );
export const inspectSeoPage = (siteId: string, inspectionUrl: string) =>
  identityRequest<SocialGoogleIndexInspection>(
    `/api/seo/sites/${encodeURIComponent(siteId)}/search-console/inspect`,
    { method: 'POST', body: JSON.stringify({ inspectionUrl }) },
  );
