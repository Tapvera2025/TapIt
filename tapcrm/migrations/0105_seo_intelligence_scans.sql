-- SEO Intelligence: scan runs, URL states, page observations, link graph.

CREATE TABLE seo_scan_runs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id           uuid NOT NULL REFERENCES seo_sites(id) ON DELETE CASCADE,
  organization_id   uuid NOT NULL,
  config_id         uuid NOT NULL REFERENCES seo_scan_configs(id),
  rule_release_id   text NOT NULL DEFAULT 'v1',
  status            text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'discovering', 'fetching', 'rendering', 'evaluating',
                      'aggregating', 'completed', 'completed_partial', 'cancelled', 'failed')),
  triggered_by      uuid,
  queued_at         timestamptz NOT NULL DEFAULT now(),
  started_at        timestamptz,
  ended_at          timestamptz,
  discovered_count  integer NOT NULL DEFAULT 0,
  fetched_count     integer NOT NULL DEFAULT 0,
  skipped_count     integer NOT NULL DEFAULT 0,
  failed_count      integer NOT NULL DEFAULT 0,
  rendered_count    integer NOT NULL DEFAULT 0,
  findings_count    integer NOT NULL DEFAULT 0,
  termination_reason text,
  coverage_pct      numeric(5,2),
  notes             text
);
ALTER TABLE seo_scan_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE seo_scan_runs FORCE ROW LEVEL SECURITY;
CREATE POLICY seo_scan_runs_tenant ON seo_scan_runs
  USING (organization_id = current_organization_id());
CREATE INDEX seo_scan_runs_site ON seo_scan_runs (site_id, queued_at DESC);
CREATE INDEX seo_scan_runs_status ON seo_scan_runs (organization_id, status);

CREATE TABLE seo_scan_url_states (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_run_id     uuid NOT NULL REFERENCES seo_scan_runs(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL,
  url             text NOT NULL,
  url_hash        text NOT NULL,
  discovery_source text NOT NULL,
  state           text NOT NULL DEFAULT 'queued'
    CHECK (state IN ('queued', 'fetching', 'fetched', 'rendering', 'rendered',
                     'skipped', 'disallowed', 'failed', 'duplicate', 'safety_rejected')),
  redirect_target text,
  http_status     integer,
  retry_count     integer NOT NULL DEFAULT 0,
  rejection_reason text,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (scan_run_id, url_hash)
);
ALTER TABLE seo_scan_url_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE seo_scan_url_states FORCE ROW LEVEL SECURITY;
CREATE POLICY seo_scan_url_states_tenant ON seo_scan_url_states
  USING (organization_id = current_organization_id());
CREATE INDEX seo_scan_url_states_run ON seo_scan_url_states (scan_run_id, state);
CREATE INDEX seo_scan_url_states_hash ON seo_scan_url_states (scan_run_id, url_hash);

CREATE TABLE seo_page_observations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_run_id      uuid NOT NULL REFERENCES seo_scan_runs(id) ON DELETE CASCADE,
  organization_id  uuid NOT NULL,
  url              text NOT NULL,
  url_hash         text NOT NULL,
  -- HTTP response
  http_status      integer,
  final_url        text,
  redirect_chain   jsonb NOT NULL DEFAULT '[]',
  content_type     text,
  content_length   integer,
  response_time_ms integer,
  -- Headers (selected, not full blob)
  canonical_header text,
  x_robots_tag     text,
  cache_control    text,
  -- Parsed page metadata
  title            text,
  meta_description text,
  meta_robots      text,
  canonical_link   text,
  h1_texts         text[] NOT NULL DEFAULT '{}',
  lang             text,
  -- Hashes for dedup/diff
  content_hash     text,
  dom_hash         text,
  -- Render details
  render_mode      text NOT NULL DEFAULT 'raw' CHECK (render_mode IN ('raw', 'rendered', 'both')),
  raw_size_bytes   integer,
  rendered_size_bytes integer,
  -- Content signals for rule evaluation
  word_count       integer,
  -- Images on the page: [{ src, alt, isDecorative, loading, isLikelyLCP }]
  images           jsonb NOT NULL DEFAULT '[]',
  -- JSON-LD block parse errors ("invalid JSON-LD block", missing @context, etc.)
  schema_errors    text[] NOT NULL DEFAULT '{}',
  -- Structured data (array of JSON-LD objects, abbreviated)
  structured_data  jsonb NOT NULL DEFAULT '[]',
  -- Hreflang entries
  hreflang_entries jsonb NOT NULL DEFAULT '[]',
  -- Performance timings
  ttfb_ms          integer,
  -- Evidence blob reference for full HTML snapshot
  evidence_blob_id uuid,
  observed_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (scan_run_id, url_hash)
);
ALTER TABLE seo_page_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE seo_page_observations FORCE ROW LEVEL SECURITY;
CREATE POLICY seo_page_observations_tenant ON seo_page_observations
  USING (organization_id = current_organization_id());
CREATE INDEX seo_page_obs_run ON seo_page_observations (scan_run_id);
CREATE INDEX seo_page_obs_hash ON seo_page_observations (scan_run_id, url_hash);
CREATE INDEX seo_page_obs_status ON seo_page_observations (scan_run_id, http_status);

CREATE TABLE seo_link_edges (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_run_id     uuid NOT NULL REFERENCES seo_scan_runs(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL,
  source_url_hash text NOT NULL,
  target_url      text NOT NULL,
  target_url_hash text NOT NULL,
  anchor_text     text,
  rel_values      text[] NOT NULL DEFAULT '{}',
  is_internal     boolean NOT NULL,
  placement       text,
  target_http_status integer,
  discovered_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE seo_link_edges ENABLE ROW LEVEL SECURITY;
ALTER TABLE seo_link_edges FORCE ROW LEVEL SECURITY;
CREATE POLICY seo_link_edges_tenant ON seo_link_edges
  USING (organization_id = current_organization_id());
CREATE INDEX seo_link_edges_run_source ON seo_link_edges (scan_run_id, source_url_hash);
CREATE INDEX seo_link_edges_run_target ON seo_link_edges (scan_run_id, target_url_hash);

CREATE TABLE seo_sitemap_entries (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_run_id     uuid NOT NULL REFERENCES seo_scan_runs(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL,
  site_id         uuid NOT NULL REFERENCES seo_sites(id) ON DELETE CASCADE,
  url             text NOT NULL,
  url_hash        text NOT NULL,
  lastmod         timestamptz,
  changefreq      text,
  priority        numeric(3,2),
  sitemap_source  text NOT NULL,
  fetched_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (scan_run_id, url_hash)
);
ALTER TABLE seo_sitemap_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE seo_sitemap_entries FORCE ROW LEVEL SECURITY;
CREATE POLICY seo_sitemap_entries_tenant ON seo_sitemap_entries
  USING (organization_id = current_organization_id());
CREATE INDEX seo_sitemap_entries_run ON seo_sitemap_entries (scan_run_id, url_hash);
