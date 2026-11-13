-- Explicit per-site allowance. Unconfigured sites cannot consume provider searches.
ALTER TABLE seo_sites ADD CONSTRAINT seo_sites_org_id_unique UNIQUE (organization_id, id);
CREATE TABLE seo_serp_allowance (
  organization_id uuid NOT NULL,
  site_id uuid NOT NULL,
  monthly_search_limit integer NOT NULL DEFAULT 0 CHECK (monthly_search_limit BETWEEN 0 AND 100000),
  PRIMARY KEY (organization_id, site_id),
  FOREIGN KEY (organization_id, site_id) REFERENCES seo_sites(organization_id, id) ON DELETE CASCADE
);
SELECT apply_tenant_rls('seo_serp_allowance');
CREATE TABLE seo_serp_search_request (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  site_id uuid NOT NULL,
  keyword_id uuid NOT NULL REFERENCES seo_keywords(id) ON DELETE CASCADE,
  check_date date NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')::date,
  requested_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, site_id) REFERENCES seo_sites(organization_id, id) ON DELETE CASCADE,
  UNIQUE (keyword_id, check_date)
);
SELECT apply_tenant_rls('seo_serp_search_request');
CREATE INDEX seo_serp_request_month ON seo_serp_search_request(organization_id, site_id, requested_at);
