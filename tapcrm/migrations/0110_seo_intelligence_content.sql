-- SEO Intelligence: competitors, content briefs, backlinks, local business locations.

CREATE TABLE seo_competitors (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id          uuid NOT NULL REFERENCES seo_sites(id) ON DELETE CASCADE,
  organization_id  uuid NOT NULL,
  competitor_domain text NOT NULL,
  discovery_method text NOT NULL DEFAULT 'manual'
    CHECK (discovery_method IN ('manual', 'serp_derived', 'gsc_derived', 'admin_configured')),
  topic_relevance  text,
  geo_relevance    text,
  enabled          boolean NOT NULL DEFAULT true,
  added_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site_id, competitor_domain)
);
ALTER TABLE seo_competitors ENABLE ROW LEVEL SECURITY;
ALTER TABLE seo_competitors FORCE ROW LEVEL SECURITY;
CREATE POLICY seo_competitors_tenant ON seo_competitors
  USING (organization_id = current_organization_id());

CREATE TABLE seo_competitor_page_snapshots (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competitor_id    uuid NOT NULL REFERENCES seo_competitors(id) ON DELETE CASCADE,
  organization_id  uuid NOT NULL,
  page_url         text NOT NULL,
  title            text,
  meta_description text,
  h1               text,
  topic_summary    text,
  detected_changes jsonb NOT NULL DEFAULT '[]',
  legal_source     text NOT NULL DEFAULT 'public_crawl',
  fetched_at       timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE seo_competitor_page_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE seo_competitor_page_snapshots FORCE ROW LEVEL SECURITY;
CREATE POLICY seo_competitor_snapshots_tenant ON seo_competitor_page_snapshots
  USING (organization_id = current_organization_id());

CREATE TABLE seo_content_briefs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id          uuid NOT NULL REFERENCES seo_sites(id) ON DELETE CASCADE,
  organization_id  uuid NOT NULL,
  title            text NOT NULL,
  target_url       text,
  keyword_ids      uuid[] NOT NULL DEFAULT '{}',
  intent           text,
  outline          jsonb NOT NULL DEFAULT '[]',
  status           text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'in_review', 'approved', 'in_progress', 'published', 'archived')),
  assigned_to      uuid,
  approved_by      uuid,
  approved_at      timestamptz,
  created_by       uuid NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE seo_content_briefs ENABLE ROW LEVEL SECURITY;
ALTER TABLE seo_content_briefs FORCE ROW LEVEL SECURITY;
CREATE POLICY seo_content_briefs_tenant ON seo_content_briefs
  USING (organization_id = current_organization_id());

CREATE TABLE seo_backlinks (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id          uuid NOT NULL REFERENCES seo_sites(id) ON DELETE CASCADE,
  organization_id  uuid NOT NULL,
  source_url       text NOT NULL,
  source_domain    text NOT NULL,
  target_url       text NOT NULL,
  anchor_text      text,
  rel_values       text[] NOT NULL DEFAULT '{}',
  provider         text NOT NULL,
  confidence       text NOT NULL DEFAULT 'inferred'
    CHECK (confidence IN ('direct', 'corroborated', 'inferred', 'unknown')),
  first_seen_at    timestamptz,
  last_seen_at     timestamptz NOT NULL DEFAULT now(),
  target_http_status integer,
  UNIQUE (site_id, source_url, target_url)
);
ALTER TABLE seo_backlinks ENABLE ROW LEVEL SECURITY;
ALTER TABLE seo_backlinks FORCE ROW LEVEL SECURITY;
CREATE POLICY seo_backlinks_tenant ON seo_backlinks
  USING (organization_id = current_organization_id());
CREATE INDEX seo_backlinks_site ON seo_backlinks (site_id, last_seen_at DESC);
CREATE INDEX seo_backlinks_domain ON seo_backlinks (site_id, source_domain);

CREATE TABLE seo_business_locations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id          uuid NOT NULL REFERENCES seo_sites(id) ON DELETE CASCADE,
  organization_id  uuid NOT NULL,
  gbp_location_id  text,
  display_name     text NOT NULL,
  address          jsonb NOT NULL DEFAULT '{}',
  target_markets   text[] NOT NULL DEFAULT '{}',
  gbp_status       text NOT NULL DEFAULT 'not_connected'
    CHECK (gbp_status IN ('not_connected', 'pending_approval', 'connected', 'error')),
  metadata         jsonb NOT NULL DEFAULT '{}',
  created_at       timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE seo_business_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE seo_business_locations FORCE ROW LEVEL SECURITY;
CREATE POLICY seo_business_locations_tenant ON seo_business_locations
  USING (organization_id = current_organization_id());
