-- Missing measurements and provider errors must remain distinguishable.
CREATE TABLE seo_performance_status (
  organization_id uuid NOT NULL,
  site_id uuid NOT NULL,
  provider text NOT NULL CHECK (provider IN ('crux', 'pagespeed')),
  state text NOT NULL CHECK (state IN ('running', 'ready', 'no_data', 'not_configured', 'error')),
  message text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, site_id, provider),
  FOREIGN KEY (organization_id, site_id) REFERENCES seo_sites(organization_id, id) ON DELETE CASCADE
);
SELECT apply_tenant_rls('seo_performance_status');
ALTER TABLE seo_cwv_observations
  ADD COLUMN collection_start date,
  ADD COLUMN collection_end date,
  ADD COLUMN lab_lcp_ms integer,
  ADD COLUMN lab_cls numeric(8,4),
  ADD COLUMN lab_tbt_ms integer;
