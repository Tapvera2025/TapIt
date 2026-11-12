-- SEO Intelligence: CWV observations, keyword difficulty, backlink domain rating,
-- per-tenant rule overrides.

-- Add keyword difficulty score (0–100) from external sources like DataForSEO.
-- Null until a licensed provider supplies it — never default to zero.
ALTER TABLE seo_keywords ADD COLUMN IF NOT EXISTS difficulty integer;

-- Add Moz/Ahrefs domain rating. Null until a backlink provider is connected.
ALTER TABLE seo_backlinks ADD COLUMN IF NOT EXISTS domain_rating numeric(5,2);

-- Core Web Vitals observations from the CrUX API.
CREATE TABLE seo_cwv_observations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id          uuid NOT NULL REFERENCES seo_sites(id) ON DELETE CASCADE,
  organization_id  uuid NOT NULL,
  -- null url = origin-level (whole site); a specific url = page-level
  url              text,
  device           text CHECK (device IN ('desktop', 'mobile', 'phone', 'tablet')),
  -- p75 values in ms (LCP, INP) or unitless (CLS)
  lcp_p75          integer,
  inp_p75          integer,
  cls_p75          numeric(6,4),
  lcp_rating       text CHECK (lcp_rating IN ('good', 'needs_improvement', 'poor')),
  inp_rating       text CHECK (inp_rating IN ('good', 'needs_improvement', 'poor')),
  cls_rating       text CHECK (cls_rating IN ('good', 'needs_improvement', 'poor')),
  form_factor      text,
  data_source      text NOT NULL DEFAULT 'crux_api',
  -- Lab performance score (0–100) from Lighthouse / PageSpeed Insights; null for CrUX rows
  perf_score       integer CHECK (perf_score BETWEEN 0 AND 100),
  observed_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE seo_cwv_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE seo_cwv_observations FORCE ROW LEVEL SECURITY;
CREATE POLICY seo_cwv_observations_tenant ON seo_cwv_observations
  USING (organization_id = current_organization_id());
CREATE INDEX seo_cwv_obs_site_date ON seo_cwv_observations (site_id, observed_at DESC);

-- Per-tenant rule configuration. Rows are seeded at tenant provisioning.
-- active=false disables a rule for all scans in this org.
-- tested=false suppresses the rule in production runs until it passes QA.
CREATE TABLE registry_seo_rule (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL,
  rule_id          text NOT NULL,
  rule_group       text NOT NULL,
  severity         text NOT NULL CHECK (severity IN ('critical', 'high', 'moderate', 'low', 'informational')),
  active           boolean NOT NULL DEFAULT true,
  tested           boolean NOT NULL DEFAULT true,
  description      text,
  UNIQUE (organization_id, rule_id)
);
ALTER TABLE registry_seo_rule ENABLE ROW LEVEL SECURITY;
ALTER TABLE registry_seo_rule FORCE ROW LEVEL SECURITY;
CREATE POLICY registry_seo_rule_tenant ON registry_seo_rule
  USING (organization_id = current_organization_id());
CREATE INDEX registry_seo_rule_org ON registry_seo_rule (organization_id, rule_group, rule_id);
