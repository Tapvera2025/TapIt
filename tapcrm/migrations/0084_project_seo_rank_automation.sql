-- Provider-backed rank fetching for the on-page SEO module. 0082 left
-- `auto_fetch_frequency` in place for "a future provider-backed scheduler";
-- this is that scheduler's storage.
--
-- Three changes:
--   1. A project maps to one verified Google Search Console property.
--   2. project_seo_rank_history can hold a row no user wrote, carries the
--      metrics the provider returned alongside the rank, and is idempotent
--      per observation window (JB-1).
--   3. project_seo_keyword records the last automated attempt's outcome, so a
--      keyword the provider cannot serve says so in the UI instead of looking
--      merely stale.

-- ---------------------------------------------------------------------
-- 1. The project → property mapping. One property per project: a project is
-- one client's one site. Re-pointing a project at a different property is an
-- UPDATE, and unlinking is a DELETE (0083's reasoning: the SEO records
-- themselves stay non-deletable, but a configuration row is not a record).
-- ---------------------------------------------------------------------
CREATE TABLE project_seo_search_console (
  organization_id uuid NOT NULL REFERENCES organization(id),
  project_id uuid NOT NULL,
  -- Either form Search Console accepts: 'sc-domain:example.com' for a domain
  -- property, or 'https://example.com/' for a URL-prefix property.
  property_url text NOT NULL CHECK (length(trim(property_url)) BETWEEN 1 AND 500),
  property_type text NOT NULL CHECK (property_type IN ('domain', 'url-prefix')),
  last_sync_at timestamptz,
  last_sync_status text CHECK (last_sync_status IS NULL OR last_sync_status IN ('ok', 'partial', 'failed')),
  last_sync_message text,
  keywords_synced integer NOT NULL DEFAULT 0 CHECK (keywords_synced >= 0),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, project_id),
  FOREIGN KEY (organization_id, project_id) REFERENCES project(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, created_by) REFERENCES app_user(organization_id, id),
  -- A domain property is always 'sc-domain:…'; a URL-prefix one never is.
  CHECK ((property_type = 'domain') = (property_url LIKE 'sc-domain:%'))
);

-- ---------------------------------------------------------------------
-- 2. Rank history: automated observations.
--
-- `created_by` was NOT NULL and references app_user, so a job could not write
-- a row at all — a job has no user (systemPrincipal's id is not an app_user).
-- It becomes nullable, and the CHECK ties nullability to the source so a
-- manual row can never lose its author.
-- ---------------------------------------------------------------------
ALTER TABLE project_seo_rank_history
  ALTER COLUMN created_by DROP NOT NULL,
  ADD CONSTRAINT project_seo_rank_history_author_ck CHECK (
    (source = 'manual' AND created_by IS NOT NULL) OR
    (source = 'automatic' AND created_by IS NULL)
  ),
  -- The provider's own numbers. Search Console returns all four in the same
  -- response as the position, and `observed_rank` rounds the position away;
  -- keeping the exact value means a 4.4 → 4.6 drift is still visible.
  ADD COLUMN exact_position numeric(7,2) CHECK (exact_position IS NULL OR exact_position > 0),
  ADD COLUMN impressions bigint CHECK (impressions IS NULL OR impressions >= 0),
  ADD COLUMN clicks bigint CHECK (clicks IS NULL OR clicks >= 0),
  ADD COLUMN ctr numeric(6,5) CHECK (ctr IS NULL OR ctr BETWEEN 0 AND 1),
  -- The date range the observation covers. Search Console reports an average
  -- over a window, not a point reading, so the window is part of the fact.
  ADD COLUMN window_start date,
  ADD COLUMN window_end date,
  ADD COLUMN provider text,
  ADD COLUMN unavailable_reason text CHECK (
    unavailable_reason IS NULL OR unavailable_reason IN ('not-ranked', 'no-data', 'unsupported')
  ),
  ADD CONSTRAINT project_seo_rank_history_window_ck CHECK (
    (window_start IS NULL AND window_end IS NULL) OR
    (window_start IS NOT NULL AND window_end IS NOT NULL AND window_start <= window_end)
  ),
  -- An automated row always names its provider and window; a manual one never
  -- does. Keeps the two kinds of observation from blurring together.
  ADD CONSTRAINT project_seo_rank_history_provider_ck CHECK (
    (source = 'automatic' AND provider IS NOT NULL AND window_end IS NOT NULL) OR
    (source = 'manual' AND provider IS NULL AND window_end IS NULL)
  );

-- JB-1 at the data layer: one automated observation per keyword per window.
-- A redelivered or retried job upserts this row rather than appending a
-- duplicate, and the upsert reports whether it inserted — which is what tells
-- the writer whether to shift previous_rank.
CREATE UNIQUE INDEX project_seo_rank_history_automatic_window_uq
  ON project_seo_rank_history (organization_id, keyword_id, window_end)
  WHERE source = 'automatic';

-- ---------------------------------------------------------------------
-- 3. Keyword: the last automated attempt.
--
-- Separate from `last_checked_at`, which means "the rank was last observed",
-- manually or not. These three say what automation last did and why, including
-- "nothing, because this configuration is not automatable" — a Bing keyword, a
-- GMB keyword, or one scoped to a city.
-- ---------------------------------------------------------------------
ALTER TABLE project_seo_keyword
  ADD COLUMN last_auto_fetch_at timestamptz,
  ADD COLUMN last_auto_fetch_outcome text CHECK (
    last_auto_fetch_outcome IS NULL OR last_auto_fetch_outcome IN ('ok', 'no-data', 'skipped', 'failed')
  ),
  ADD COLUMN last_auto_fetch_message text;

-- The sweeper's selection: due keywords of the projects that have a property.
CREATE INDEX project_seo_keyword_auto_fetch_idx
  ON project_seo_keyword (organization_id, project_id, auto_fetch_frequency, last_auto_fetch_at)
  WHERE archived_at IS NULL AND auto_fetch_frequency <> 'manual';

SELECT apply_tenant_rls('project_seo_search_console');
GRANT SELECT, INSERT, UPDATE, DELETE ON project_seo_search_console TO tapcrm_app;
