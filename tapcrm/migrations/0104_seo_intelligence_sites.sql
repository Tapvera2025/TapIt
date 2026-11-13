-- SEO Intelligence: sites, seed URLs, scan configuration.
-- All tables are tenant-scoped (organization_id) and client-scoped (client_id).

CREATE TABLE seo_sites (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  client_id        uuid NOT NULL,
  display_url      text NOT NULL,
  normalized_host  text NOT NULL,
  scope_path       text NOT NULL DEFAULT '/',
  canonical_scheme text NOT NULL DEFAULT 'https' CHECK (canonical_scheme IN ('http', 'https')),
  ownership_state  text NOT NULL DEFAULT 'unverified'
    CHECK (ownership_state IN ('unverified', 'dns_txt_pending', 'html_token_pending', 'verified', 'revoked')),
  ownership_token  text,
  timezone         text NOT NULL DEFAULT 'UTC',
  locale           text NOT NULL DEFAULT 'en',
  business_intents text[] NOT NULL DEFAULT '{}',
  stack_notes      text,
  config_version   integer NOT NULL DEFAULT 1,
  active           boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, normalized_host, scope_path),
  FOREIGN KEY (organization_id, client_id) REFERENCES client(organization_id, id) ON DELETE CASCADE
);
ALTER TABLE seo_sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE seo_sites FORCE ROW LEVEL SECURITY;
CREATE POLICY seo_sites_tenant ON seo_sites
  USING (organization_id = current_organization_id());

CREATE TABLE seo_site_seeds (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id          uuid NOT NULL REFERENCES seo_sites(id) ON DELETE CASCADE,
  organization_id  uuid NOT NULL,
  input_url        text NOT NULL,
  discovery_source text NOT NULL CHECK (discovery_source IN ('manual', 'sitemap', 'gsc', 'crawl', 'cms_export')),
  is_priority      boolean NOT NULL DEFAULT false,
  is_sitemap_root  boolean NOT NULL DEFAULT false,
  added_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site_id, input_url)
);
ALTER TABLE seo_site_seeds ENABLE ROW LEVEL SECURITY;
ALTER TABLE seo_site_seeds FORCE ROW LEVEL SECURITY;
CREATE POLICY seo_site_seeds_tenant ON seo_site_seeds
  USING (organization_id = current_organization_id());

CREATE TABLE seo_scan_configs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id             uuid NOT NULL REFERENCES seo_sites(id) ON DELETE CASCADE,
  organization_id     uuid NOT NULL,
  revision            integer NOT NULL DEFAULT 1,
  max_depth           integer NOT NULL DEFAULT 5 CHECK (max_depth BETWEEN 1 AND 20),
  max_pages           integer NOT NULL DEFAULT 1000 CHECK (max_pages BETWEEN 1 AND 100000),
  max_bytes_per_page  integer NOT NULL DEFAULT 5242880,
  concurrency         integer NOT NULL DEFAULT 3 CHECK (concurrency BETWEEN 1 AND 10),
  render_policy       text NOT NULL DEFAULT 'heuristic'
    CHECK (render_policy IN ('never', 'heuristic', 'always')),
  max_render_pages    integer NOT NULL DEFAULT 100,
  respect_robots      boolean NOT NULL DEFAULT true,
  follow_sitemaps     boolean NOT NULL DEFAULT true,
  crawl_delay_ms      integer NOT NULL DEFAULT 500 CHECK (crawl_delay_ms BETWEEN 0 AND 30000),
  exclusion_patterns  text[] NOT NULL DEFAULT '{}',
  schedule_cron       text,
  rule_release_id     text NOT NULL DEFAULT 'v1',
  config_json         jsonb NOT NULL DEFAULT '{}',
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site_id, revision)
);
ALTER TABLE seo_scan_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE seo_scan_configs FORCE ROW LEVEL SECURITY;
CREATE POLICY seo_scan_configs_tenant ON seo_scan_configs
  USING (organization_id = current_organization_id());

CREATE INDEX seo_sites_org_client ON seo_sites (organization_id, client_id);
CREATE INDEX seo_sites_host ON seo_sites (organization_id, normalized_host);
CREATE INDEX seo_site_seeds_site ON seo_site_seeds (site_id);
CREATE INDEX seo_scan_configs_site ON seo_scan_configs (site_id);
