-- Live Google position checks for project keywords.
--
-- Search Console reports an AVERAGE position over a window, and cannot answer
-- for a city, for Bing or for the local (GMB) pack. A live check asks a search
-- provider (SerpApi) what the results page shows right now for the keyword's
-- country, city and device, and records the exact position and the page that
-- ranked. Search Console stays the fallback when a live check cannot run.
--
-- A live check is paid per results page, so each project has an explicit
-- monthly allowance. 0, the default, disables live checks — the same rule as
-- an SEO website's allowance (0116): no paid search runs without an opt-in.
--
-- Additive and forward-only (tools/migrate.ts).

-- ---------------------------------------------------------------------
-- 1. Rank history holds live observations: the person who asked, the
--    provider, the page that ranked, where the search ran and how many
--    results were looked through. A live row has no window: it is a reading
--    taken at one moment, like a manual one.
-- ---------------------------------------------------------------------
ALTER TABLE project_seo_rank_history DROP CONSTRAINT project_seo_rank_history_source_check;
ALTER TABLE project_seo_rank_history
  ADD CONSTRAINT project_seo_rank_history_source_check
    CHECK (source IN ('manual', 'automatic', 'live'));

ALTER TABLE project_seo_rank_history DROP CONSTRAINT project_seo_rank_history_author_ck;
ALTER TABLE project_seo_rank_history
  ADD CONSTRAINT project_seo_rank_history_author_ck CHECK (
    (source IN ('manual', 'live') AND created_by IS NOT NULL) OR
    (source = 'automatic' AND created_by IS NULL)
  );

ALTER TABLE project_seo_rank_history DROP CONSTRAINT project_seo_rank_history_provider_ck;
ALTER TABLE project_seo_rank_history
  ADD CONSTRAINT project_seo_rank_history_provider_ck CHECK (
    (source = 'automatic' AND provider IS NOT NULL AND window_end IS NOT NULL) OR
    (source = 'manual' AND provider IS NULL AND window_end IS NULL) OR
    (source = 'live' AND provider IS NOT NULL AND window_end IS NULL)
  );

ALTER TABLE project_seo_rank_history
  ADD COLUMN ranking_url text CHECK (ranking_url IS NULL OR length(ranking_url) <= 2000),
  ADD COLUMN search_location text CHECK (search_location IS NULL OR length(search_location) <= 300),
  ADD COLUMN results_checked integer CHECK (results_checked IS NULL OR results_checked BETWEEN 0 AND 1000);

-- ---------------------------------------------------------------------
-- 2. The keyword's latest live reading, so a list can show it without
--    reading history. Separate from the Search Console attempt columns
--    (0084): the two answer different questions.
-- ---------------------------------------------------------------------
ALTER TABLE project_seo_keyword
  ADD COLUMN last_live_check_at timestamptz,
  ADD COLUMN last_live_outcome text CHECK (
    last_live_outcome IS NULL OR last_live_outcome IN ('found', 'not-found', 'failed')
  ),
  ADD COLUMN last_live_position integer CHECK (last_live_position IS NULL OR last_live_position BETWEEN 1 AND 1000),
  ADD COLUMN last_live_url text CHECK (last_live_url IS NULL OR length(last_live_url) <= 2000),
  ADD COLUMN last_live_location text CHECK (last_live_location IS NULL OR length(last_live_location) <= 300),
  ADD COLUMN last_live_depth integer CHECK (last_live_depth IS NULL OR last_live_depth BETWEEN 1 AND 1000),
  ADD COLUMN last_live_message text CHECK (last_live_message IS NULL OR length(last_live_message) <= 1000);

-- ---------------------------------------------------------------------
-- 3. Per-project settings for live checks: the website to look for when a
--    keyword names no target URL, and the monthly number of results pages
--    the project may request.
-- ---------------------------------------------------------------------
CREATE TABLE project_seo_settings (
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  website_url text CHECK (website_url IS NULL OR length(website_url) BETWEEN 1 AND 2000),
  monthly_search_limit integer NOT NULL DEFAULT 0 CHECK (monthly_search_limit BETWEEN 0 AND 100000),
  updated_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, project_id),
  FOREIGN KEY (organization_id, project_id) REFERENCES project (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, updated_by) REFERENCES app_user (organization_id, id)
);

-- One row per results page requested, failed requests included: they are
-- billed too. The month's count is what the allowance is checked against.
CREATE TABLE project_seo_serp_request (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  keyword_id uuid NOT NULL,
  requested_by uuid NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, project_id) REFERENCES project (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, keyword_id) REFERENCES project_seo_keyword (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, requested_by) REFERENCES app_user (organization_id, id)
);
CREATE INDEX project_seo_serp_request_month_idx
  ON project_seo_serp_request (organization_id, project_id, requested_at);

SELECT apply_tenant_rls('project_seo_settings');
SELECT apply_tenant_rls('project_seo_serp_request');
GRANT SELECT, INSERT, UPDATE ON project_seo_settings TO tapcrm_app;
GRANT SELECT, INSERT ON project_seo_serp_request TO tapcrm_app;
