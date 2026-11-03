import type {
  SeoSite, SeoScanConfig, SeoScanRun, SeoFinding, SeoFindingStatus,
  SeoSeverity, SeoConfidence, SeoSiteOwnershipState, SeoScanStatus,
  SeoGscMetrics, SeoKeyword, SeoSerpObservation, SeoAiObservation,
  SeoAiAnalysis,
} from '@tapcrm/contracts';

export type {
  SeoSite, SeoScanConfig, SeoScanRun, SeoFinding, SeoFindingStatus,
  SeoSeverity, SeoConfidence, SeoSiteOwnershipState, SeoScanStatus,
  SeoGscMetrics, SeoKeyword, SeoSerpObservation, SeoAiObservation,
  SeoAiAnalysis,
};

/** Internal DB row shapes (snake_case from SQL) */
export interface DbSeoSite {
  id: string;
  organization_id: string;
  client_id: string | null;
  display_url: string;
  normalized_host: string;
  scope_path: string;
  canonical_scheme: string;
  ownership_state: SeoSiteOwnershipState;
  ownership_token: string | null;
  timezone: string;
  locale: string;
  business_intents: string[];
  stack_notes: string | null;
  config_version: number;
  active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface DbSeoScanRun {
  id: string;
  site_id: string;
  organization_id: string;
  config_id: string;
  rule_release_id: string;
  status: SeoScanStatus;
  triggered_by: string | null;
  queued_at: Date;
  started_at: Date | null;
  ended_at: Date | null;
  discovered_count: number;
  fetched_count: number;
  skipped_count: number;
  failed_count: number;
  rendered_count: number;
  findings_count: number;
  termination_reason: string | null;
  coverage_pct: number | null;
}

export interface DbSeoFinding {
  id: string;
  site_id: string;
  organization_id: string;
  rule_id: string;
  rule_version: string;
  signature: string;
  affected_target: string;
  status: SeoFindingStatus;
  severity: SeoSeverity;
  confidence: SeoConfidence;
  priority_score: number | null;
  assigned_to: string | null;
  first_seen_run: string;
  latest_run: string;
  first_seen_at: Date;
  last_seen_at: Date;
  resolved_at: Date | null;
  resolution_run: string | null;
}

export interface DbSeoGscMetrics {
  id: string;
  site_id: string;
  organization_id: string;
  property_url: string;
  date: Date;
  search_type: string;
  query: string | null;
  page: string | null;
  country: string | null;
  device: string | null;
  clicks: number;
  impressions: number;
  ctr: number | null;
  avg_position: number | null;
  data_complete: boolean;
  row_limit_hit: boolean;
  synced_at: Date;
}

/** Job types for the seo-intelligence job scheduler */
export type SeoJobType =
  | 'seo:crawl_discover'
  | 'seo:crawl_fetch'
  | 'seo:crawl_render'
  | 'seo:evaluate'
  | 'seo:aggregate'
  | 'seo:gsc_sync'
  | 'seo:url_inspect'
  | 'seo:lighthouse_audit'
  | 'seo:crux_fetch'
  | 'seo:serp_observe'
  | 'seo:ai_visibility_observe'
  | 'seo:ai_explain'
  | 'seo:fix_verify'
  | 'seo:alert_dispatch'
  | 'seo:report_export';

export interface SeoJobPayload {
  organizationId: string;
  siteId: string;
  scanRunId?: string;
  extra?: Record<string, unknown>;
}
