/** Public-facing types for the SEO Intelligence module. */

export type SeoSiteOwnershipState = 'unverified' | 'dns_txt_pending' | 'html_token_pending' | 'verified' | 'revoked';
export type SeoScanStatus =
  | 'queued' | 'discovering' | 'fetching' | 'rendering' | 'evaluating'
  | 'aggregating' | 'completed' | 'completed_partial' | 'cancelled' | 'failed';
export type SeoFindingStatus =
  | 'open' | 'assigned' | 'in_progress' | 'ready_for_verification'
  | 'verified_resolved' | 'accepted_exception' | 'false_positive' | 'unverifiable' | 'reopened';
export type SeoSeverity = 'critical' | 'high' | 'moderate' | 'low' | 'informational';
export type SeoConfidence = 'direct' | 'corroborated' | 'inferred' | 'unknown';
export type SeoRenderMode = 'raw' | 'rendered' | 'both';
export type SeoProviderState =
  | 'available' | 'not_connected' | 'pending_approval' | 'not_supported'
  | 'quota_exhausted' | 'budget_blocked' | 'temporarily_unavailable'
  | 'blocked_by_website' | 'not_observed' | 'insufficient_data';

/** Provenance attached to every external metric. */
export interface SeoProvenance {
  provider: string;
  observedAt: string;
  capturedAt: string;
  region?: string;
  device?: 'desktop' | 'mobile';
  rawEvidenceRef?: string;
}

/** Wrapper for any provider result — null data is never a fabricated zero. */
export interface SeoProviderResult<T> {
  state: SeoProviderState;
  data: T | null;
  provenance?: SeoProvenance;
  coverage?: { attempted: number; successful: number; failed: number };
  usage?: { units: number; estimatedUsd: number; actualUsd?: number };
  warningCodes?: string[];
}

export interface SeoSite {
  id: string;
  organizationId: string;
  clientId: string | null;
  displayUrl: string;
  normalizedHost: string;
  scopePath: string;
  canonicalScheme: 'http' | 'https';
  ownershipState: SeoSiteOwnershipState;
  timezone: string;
  locale: string;
  businessIntents: string[];
  stackNotes: string | null;
  configVersion: number;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface SeoScanConfig {
  id: string;
  siteId: string;
  revision: number;
  maxDepth: number;
  maxPages: number;
  renderPolicy: 'never' | 'heuristic' | 'always';
  maxRenderPages: number;
  respectRobots: boolean;
  followSitemaps: boolean;
  crawlDelayMs: number;
  exclusionPatterns: string[];
  scheduleCron: string | null;
  ruleReleaseId: string;
}

export interface SeoScanRun {
  id: string;
  siteId: string;
  configId: string;
  ruleReleaseId: string;
  status: SeoScanStatus;
  queuedAt: Date;
  startedAt: Date | null;
  endedAt: Date | null;
  discoveredCount: number;
  fetchedCount: number;
  skippedCount: number;
  failedCount: number;
  renderedCount: number;
  findingsCount: number;
  terminationReason: string | null;
  coveragePct: number | null;
}

export interface SeoFinding {
  id: string;
  siteId: string;
  ruleId: string;
  ruleVersion: string;
  signature: string;
  affectedTarget: string;
  status: SeoFindingStatus;
  severity: SeoSeverity;
  confidence: SeoConfidence;
  priorityScore: number | null;
  assignedTo: string | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
  resolvedAt: Date | null;
  /** Latest finding-instance evidence (rule-specific jsonb). Example for L001:
   *  { url, broken_links: [...] }. For T001: { url, word_count }. */
  evidence: Record<string, unknown> | null;
}

export interface SeoFindingEvidence {
  evidenceId: string;
  statement: string;
  source: string;
  observedAt: string;
}

/**
 * A collapsed view of open findings grouped by (ruleId, severity). The UI uses
 * this to show "N pages affected" instead of N identical rows when a template
 * bug fires across many pages. sampleTargets/sampleIds carry the top-5 (highest
 * priority) members so admins can preview before expanding.
 */
export interface SeoFindingGroup {
  ruleId: string;
  severity: SeoSeverity;
  count: number;
  maxPriority: number | null;
  firstSeenAt: Date;
  sampleTargets: string[];
  sampleIds: string[];
}

/** One UTC calendar day and severity bucket for the Overview trend chart. */
export interface SeoFindingsTrendPoint {
  /** ISO calendar date (YYYY-MM-DD), not a timestamp. */
  day: string;
  severity: SeoSeverity;
  openCount: number;
}

export interface SeoRuleEvaluation {
  id: string;
  ruleId: string;
  ruleVersion: string;
  result: 'pass' | 'fail' | 'review' | 'skipped' | 'unknown';
  severity: SeoSeverity;
  confidence: SeoConfidence;
  affectedTarget: string | null;
  evidence: Record<string, unknown>;
  proposedFix: string | null;
}

export interface SeoGscMetrics {
  date: string;
  searchType: string;
  query: string | null;
  page: string | null;
  country: string | null;
  device: string | null;
  clicks: number;
  impressions: number;
  ctr: number | null;
  /** GSC average position: NOT a pinned live rank. */
  avgPosition: number | null;
  dataComplete: boolean;
  rowLimitHit: boolean;
}

export interface SeoKeyword {
  id: string;
  siteId: string;
  setId: string;
  keyword: string;
  intent: string | null;
  locale: string | null;
  language: string;
  country: string;
  device: 'desktop' | 'mobile';
  /** Null when no licensed source has provided volume data. */
  searchVolume: number | null;
  difficulty: number | null;
  volumeSource: string | null;
  volumeDate: string | null;
  tracked: boolean;
  checkCadence: 'manual' | 'daily' | 'weekly' | 'monthly';
}

export interface SeoSerpObservation {
  id: string;
  keywordId: string;
  engine: string;
  country: string;
  device: 'desktop' | 'mobile';
  provider: string;
  query: string | null;
  /** null means not observed in that snapshot — not the same as not ranked. */
  organicRank: number | null;
  observedUrl: string | null;
  resultType: string | null;
  snapshotComplete: boolean;
  state: 'observed' | 'not_observed' | 'unavailable' | 'quota_exhausted' | 'budget_blocked';
  observedAt: Date;
}

export interface SeoAiObservation {
  id: string;
  promptId: string;
  promptText: string | null;
  provider: string;
  platform: string;
  locale: string;
  brandMentioned: boolean | null;
  domainCited: boolean | null;
  citationUrls: string[];
  state: 'success' | 'partial' | 'no_answer' | 'failed' | 'quota_exhausted' | 'budget_blocked';
  observedAt: Date;
}

/** Structured output from the AI analysis service. Schema-validated. */
export interface SeoAiAnalysis {
  findingIds: string[];
  observedFacts: Array<{ evidenceId: string; statement: string }>;
  hypotheses: Array<{
    cause: string;
    confidence: SeoConfidence;
    supports: string[];
    unknowns: string[];
  }>;
  impactReasoning: { businessGoal: string; supportingEvidenceIds: string[] };
  proposedFix: { summary: string; platform: string; steps: string[]; risks: string[] };
  verification: { rulesToRecheck: string[]; expectedObservations: string[] };
  requiresHumanReview: true;
}

export interface SeoBudgetConfig {
  organizationId: string;
  monthlyProviderCentCeiling: number;
  warningThreshold70: boolean;
  warningThreshold90: boolean;
}

export interface SeoOverviewSummary {
  siteId: string;
  lastScanRun: SeoScanRun | null;
  openFindings: { critical: number; high: number; moderate: number; low: number };
  providerHealth: Record<string, SeoProviderState>;
  budgetUsedUsd: number;
  budgetCapUsd: number;
}

export interface SeoBacklink {
  id: string;
  siteId: string;
  sourceUrl: string;
  targetUrl: string;
  anchorText: string | null;
  relValues: string[];
  domainRating: number | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
}

export interface SeoCwvObservation {
  id: string;
  siteId: string;
  url: string | null;
  dataSource: string;
  device: string | null;
  perfScore: number | null;
  labLcpMs: number | null;
  labCls: number | null;
  labTbtMs: number | null;
  collectionStart: string | null;
  collectionEnd: string | null;
  lcpP75: number | null;
  inpP75: number | null;
  clsP75: number | null;
  lcpRating: 'good' | 'needs_improvement' | 'poor' | null;
  inpRating: 'good' | 'needs_improvement' | 'poor' | null;
  clsRating: 'good' | 'needs_improvement' | 'poor' | null;
  observedAt: Date;
}

export interface SeoFixProposal {
  id: string;
  findingId: string;
  ruleId: string;
  severity: SeoSeverity;
  affectedTarget: string;
  proposedFix: string | null;
  status: 'draft' | 'pending_review' | 'approved' | 'executing' | 'executed' | 'failed' | 'rolled_back' | 'rejected';
  createdAt: Date;
  updatedAt: Date;
}

export interface SeoAlert {
  id: string;
  siteId: string;
  title: string;
  body: string;
  severity: SeoSeverity;
  createdAt: Date;
  acknowledgedAt: Date | null;
}

export interface SeoRuleRow {
  ruleId: string;
  group: string;
  severity: string;
  active: boolean;
  tested: boolean;
  description: string | null;
}
