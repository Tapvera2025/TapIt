-- SEO Intelligence: keyword strategy, SERP observations.

CREATE TABLE seo_keyword_sets (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id          uuid NOT NULL REFERENCES seo_sites(id) ON DELETE CASCADE,
  organization_id  uuid NOT NULL,
  name             text NOT NULL,
  description      text,
  created_at       timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE seo_keyword_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE seo_keyword_sets FORCE ROW LEVEL SECURITY;
CREATE POLICY seo_keyword_sets_tenant ON seo_keyword_sets
  USING (organization_id = current_organization_id());

CREATE TABLE seo_keywords (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  set_id           uuid NOT NULL REFERENCES seo_keyword_sets(id) ON DELETE CASCADE,
  site_id          uuid NOT NULL REFERENCES seo_sites(id) ON DELETE CASCADE,
  organization_id  uuid NOT NULL,
  keyword          text NOT NULL,
  intent           text CHECK (intent IN ('informational', 'navigational', 'commercial', 'transactional')),
  locale           text,
  language         text NOT NULL DEFAULT 'en',
  country          text NOT NULL DEFAULT 'global',
  device           text NOT NULL DEFAULT 'desktop' CHECK (device IN ('desktop', 'mobile')),
  -- Volume is null when no licensed source provided it — never default to zero
  search_volume    integer,
  volume_source    text,
  volume_date      date,
  cluster_id       uuid,
  notes            text,
  tracked          boolean NOT NULL DEFAULT true,
  check_cadence    text NOT NULL DEFAULT 'weekly'
    CHECK (check_cadence IN ('manual', 'daily', 'weekly', 'monthly')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site_id, keyword, country, device)
);
ALTER TABLE seo_keywords ENABLE ROW LEVEL SECURITY;
ALTER TABLE seo_keywords FORCE ROW LEVEL SECURITY;
CREATE POLICY seo_keywords_tenant ON seo_keywords
  USING (organization_id = current_organization_id());
CREATE INDEX seo_keywords_set ON seo_keywords (set_id);
CREATE INDEX seo_keywords_site ON seo_keywords (site_id);

CREATE TABLE seo_keyword_page_maps (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  keyword_id       uuid NOT NULL REFERENCES seo_keywords(id) ON DELETE CASCADE,
  site_id          uuid NOT NULL REFERENCES seo_sites(id) ON DELETE CASCADE,
  organization_id  uuid NOT NULL,
  landing_url      text NOT NULL,
  status           text NOT NULL DEFAULT 'candidate'
    CHECK (status IN ('candidate', 'approved', 'rejected', 'deprecated')),
  confidence       text NOT NULL DEFAULT 'inferred'
    CHECK (confidence IN ('direct', 'corroborated', 'inferred', 'unknown')),
  approved_by      uuid,
  approved_at      timestamptz,
  UNIQUE (keyword_id, landing_url)
);
ALTER TABLE seo_keyword_page_maps ENABLE ROW LEVEL SECURITY;
ALTER TABLE seo_keyword_page_maps FORCE ROW LEVEL SECURITY;
CREATE POLICY seo_keyword_page_maps_tenant ON seo_keyword_page_maps
  USING (organization_id = current_organization_id());

CREATE TABLE seo_serp_observations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  keyword_id       uuid NOT NULL REFERENCES seo_keywords(id) ON DELETE CASCADE,
  site_id          uuid NOT NULL REFERENCES seo_sites(id) ON DELETE CASCADE,
  organization_id  uuid NOT NULL,
  engine           text NOT NULL,
  country          text NOT NULL,
  geo              text,
  device           text NOT NULL CHECK (device IN ('desktop', 'mobile')),
  provider         text NOT NULL,
  provider_request_id uuid REFERENCES seo_provider_requests(id),
  -- Observed result (null = not observed in snapshot)
  organic_rank     integer,
  observed_url     text,
  result_type      text,
  snapshot_complete boolean NOT NULL DEFAULT true,
  -- Explicitly: unavailable/unobserved ≠ not ranked
  state            text NOT NULL DEFAULT 'observed'
    CHECK (state IN ('observed', 'not_observed', 'unavailable', 'quota_exhausted', 'budget_blocked')),
  observed_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE seo_serp_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE seo_serp_observations FORCE ROW LEVEL SECURITY;
CREATE POLICY seo_serp_observations_tenant ON seo_serp_observations
  USING (organization_id = current_organization_id());
CREATE INDEX seo_serp_obs_keyword_date ON seo_serp_observations (keyword_id, observed_at DESC);
CREATE INDEX seo_serp_obs_site_date ON seo_serp_observations (site_id, observed_at DESC);
