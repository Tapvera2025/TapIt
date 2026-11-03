-- SEO Intelligence: GSC metrics and URL inspections.
-- (CWV observations table lives in migration 0113 to match the contracts shape.)

CREATE TABLE seo_gsc_metrics (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id          uuid NOT NULL REFERENCES seo_sites(id) ON DELETE CASCADE,
  organization_id  uuid NOT NULL,
  property_url     text NOT NULL,
  date             date NOT NULL,
  search_type      text NOT NULL DEFAULT 'web' CHECK (search_type IN ('web', 'image', 'video', 'news', 'discover', 'googleNews')),
  -- Dimension grain: null means "all" for that dimension
  query            text,
  page             text,
  country          text,
  device           text,
  -- Metrics
  clicks           integer NOT NULL DEFAULT 0,
  impressions      integer NOT NULL DEFAULT 0,
  ctr              numeric(8,6),
  -- Average position over the window: NOT a pinned SERP rank.
  avg_position     numeric(8,2),
  -- Source metadata
  data_complete    boolean NOT NULL DEFAULT true,
  row_limit_hit    boolean NOT NULL DEFAULT false,
  synced_at        timestamptz NOT NULL DEFAULT now(),
  -- Grain key: all non-null dimension values form the unique identifier
  UNIQUE NULLS NOT DISTINCT (site_id, date, search_type, query, page, country, device)
);
ALTER TABLE seo_gsc_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE seo_gsc_metrics FORCE ROW LEVEL SECURITY;
CREATE POLICY seo_gsc_metrics_tenant ON seo_gsc_metrics
  USING (organization_id = current_organization_id());
CREATE INDEX seo_gsc_metrics_site_date ON seo_gsc_metrics (site_id, date DESC);
CREATE INDEX seo_gsc_metrics_site_query ON seo_gsc_metrics (site_id, query) WHERE query IS NOT NULL;
CREATE INDEX seo_gsc_metrics_site_page ON seo_gsc_metrics (site_id, page) WHERE page IS NOT NULL;

CREATE TABLE seo_index_inspections (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id          uuid NOT NULL REFERENCES seo_sites(id) ON DELETE CASCADE,
  organization_id  uuid NOT NULL,
  inspected_url    text NOT NULL,
  property_url     text NOT NULL,
  -- Google's reported state (verbatim from API)
  verdict          text,
  coverage_state   text,
  robots_txt_state text,
  indexing_state   text,
  page_fetch_state text,
  google_canonical text,
  user_canonical   text,
  last_crawl_time  timestamptz,
  raw_response     jsonb NOT NULL DEFAULT '{}',
  inspected_at     timestamptz NOT NULL DEFAULT now(),
  -- Quota tracking: 2,000 per property per day
  quota_date       date NOT NULL DEFAULT current_date
);
ALTER TABLE seo_index_inspections ENABLE ROW LEVEL SECURITY;
ALTER TABLE seo_index_inspections FORCE ROW LEVEL SECURITY;
CREATE POLICY seo_index_inspections_tenant ON seo_index_inspections
  USING (organization_id = current_organization_id());
CREATE INDEX seo_index_inspections_site ON seo_index_inspections (site_id, inspected_at DESC);
CREATE UNIQUE INDEX seo_index_inspections_url_latest ON seo_index_inspections (site_id, inspected_url, inspected_at DESC);

