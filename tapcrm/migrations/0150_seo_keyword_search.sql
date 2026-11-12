-- Keyword search in the SEO dashboard.
--
-- 1. "Scan a website": a live position check for one of the organization's SEO
--    websites, for any keyword, country, city, device and engine. Each results
--    page it requests is paid, so it spends from that website's own monthly
--    search allowance (0116) like the scheduled position checks do. A scan is
--    not a tracked keyword, so its request rows carry purpose 'scan' and no
--    keyword, and its outcome is kept in its own log.
-- 2. Project live checks look through a chosen number of results (10 to 100).
--    Every page past the first is another paid search, so the depth is a
--    per-project setting, 30 by default.
--
-- Additive and forward-only (tools/migrate.ts).

-- ---------------------------------------------------------------------
-- 1. Website scans
-- ---------------------------------------------------------------------
ALTER TABLE seo_serp_search_request DROP CONSTRAINT seo_serp_search_request_purpose_check;
ALTER TABLE seo_serp_search_request
  ADD CONSTRAINT seo_serp_search_request_purpose_check
    CHECK (purpose IN ('rank', 'ai_overview', 'scan'));

CREATE TABLE seo_rank_scan (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL,
  site_id uuid NOT NULL,
  keyword text NOT NULL CHECK (length(keyword) BETWEEN 1 AND 200),
  engine text NOT NULL CHECK (engine IN ('google', 'bing', 'google_local')),
  country text NOT NULL CHECK (length(country) BETWEEN 1 AND 100),
  city text CHECK (city IS NULL OR length(city) BETWEEN 1 AND 100),
  search_location text NOT NULL CHECK (length(search_location) <= 300),
  device text NOT NULL CHECK (device IN ('desktop', 'mobile')),
  depth integer NOT NULL CHECK (depth BETWEEN 10 AND 100),
  status text NOT NULL CHECK (status IN ('found', 'not-found', 'failed')),
  position integer CHECK (position IS NULL OR position BETWEEN 1 AND 1000),
  ranking_url text CHECK (ranking_url IS NULL OR length(ranking_url) <= 2000),
  ranking_title text CHECK (ranking_title IS NULL OR length(ranking_title) <= 500),
  results_checked integer CHECK (results_checked IS NULL OR results_checked BETWEEN 0 AND 1000),
  pages_requested integer NOT NULL DEFAULT 0 CHECK (pages_requested BETWEEN 0 AND 20),
  top_results jsonb NOT NULL DEFAULT '[]'::jsonb,
  message text CHECK (message IS NULL OR length(message) <= 1000),
  requested_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'found') = (position IS NOT NULL)),
  FOREIGN KEY (organization_id, site_id) REFERENCES seo_sites (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, requested_by) REFERENCES app_user (organization_id, id)
);
CREATE INDEX seo_rank_scan_site_idx ON seo_rank_scan (organization_id, site_id, created_at DESC);
SELECT apply_tenant_rls('seo_rank_scan');
-- A scan is a record of what a search showed at one moment: append-only.
REVOKE UPDATE, DELETE ON seo_rank_scan FROM tapcrm_app;

-- ---------------------------------------------------------------------
-- 2. How deep a project live check looks
-- ---------------------------------------------------------------------
ALTER TABLE project_seo_settings
  ADD COLUMN search_depth integer NOT NULL DEFAULT 30 CHECK (search_depth IN (10, 20, 30, 50, 100));
