-- Project-scoped on-page SEO reporting. Rank observations are manual for now;
-- the frequency column is retained for a future provider-backed scheduler.
CREATE TABLE project_seo_keyword (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL REFERENCES organization(id),
  project_id uuid NOT NULL,
  keyword text NOT NULL CHECK (length(trim(keyword)) BETWEEN 1 AND 200),
  initial_rank integer NOT NULL CHECK (initial_rank BETWEEN 1 AND 100000),
  previous_rank integer CHECK (previous_rank IS NULL OR previous_rank BETWEEN 1 AND 100000),
  current_rank integer CHECK (current_rank IS NULL OR current_rank BETWEEN 1 AND 100000),
  target_url text,
  keyword_link text,
  search_engine text NOT NULL DEFAULT 'google' CHECK (search_engine IN ('google', 'bing')),
  country text NOT NULL DEFAULT 'global',
  city text,
  device text NOT NULL DEFAULT 'desktop' CHECK (device IN ('desktop', 'mobile')),
  auto_fetch_frequency text NOT NULL DEFAULT 'manual' CHECK (auto_fetch_frequency IN ('manual', 'daily', 'weekly', 'monthly')),
  priority text NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
  category text NOT NULL CHECK (category IN ('seo', 'gmb')),
  notes text,
  last_checked_at timestamptz,
  archived_at timestamptz,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, project_id) REFERENCES project(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, created_by) REFERENCES app_user(organization_id, id)
);

CREATE UNIQUE INDEX project_seo_keyword_configuration_uq ON project_seo_keyword (
  organization_id, project_id, lower(trim(keyword)), lower(coalesce(target_url, '')),
  lower(coalesce(country, '')), lower(coalesce(city, '')), search_engine, device
) WHERE archived_at IS NULL;

CREATE TABLE project_seo_rank_history (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL REFERENCES organization(id),
  keyword_id uuid NOT NULL,
  observed_rank integer CHECK (observed_rank IS NULL OR observed_rank BETWEEN 1 AND 100000),
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'automatic')),
  status text NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'unavailable')),
  observed_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  FOREIGN KEY (organization_id, keyword_id) REFERENCES project_seo_keyword(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, created_by) REFERENCES app_user(organization_id, id),
  CHECK ((status = 'available' AND observed_rank IS NOT NULL) OR (status = 'unavailable' AND observed_rank IS NULL))
);
CREATE INDEX project_seo_rank_history_lookup_idx ON project_seo_rank_history(organization_id, keyword_id, observed_at DESC);

CREATE TABLE project_seo_blog_post (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL REFERENCES organization(id),
  project_id uuid NOT NULL,
  title text NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 300),
  url text,
  description text,
  category text NOT NULL CHECK (category IN ('blog-post', 'article', 'news', 'tutorial', 'case-study', 'other')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  publish_date date,
  word_count integer NOT NULL DEFAULT 0 CHECK (word_count >= 0),
  notes text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, project_id) REFERENCES project(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, created_by) REFERENCES app_user(organization_id, id)
);
CREATE INDEX project_seo_blog_post_project_idx ON project_seo_blog_post(organization_id, project_id, status, updated_at DESC);

CREATE TABLE project_seo_blog_keyword (
  organization_id uuid NOT NULL REFERENCES organization(id),
  blog_post_id uuid NOT NULL,
  keyword text NOT NULL CHECK (length(trim(keyword)) BETWEEN 1 AND 200),
  PRIMARY KEY (blog_post_id, keyword),
  FOREIGN KEY (organization_id, blog_post_id) REFERENCES project_seo_blog_post(organization_id, id) ON DELETE CASCADE
);

SELECT apply_tenant_rls('project_seo_keyword');
SELECT apply_tenant_rls('project_seo_rank_history');
SELECT apply_tenant_rls('project_seo_blog_post');
SELECT apply_tenant_rls('project_seo_blog_keyword');
GRANT SELECT, INSERT, UPDATE ON project_seo_keyword, project_seo_rank_history, project_seo_blog_post, project_seo_blog_keyword TO tapcrm_app;
REVOKE DELETE ON project_seo_keyword, project_seo_rank_history, project_seo_blog_post, project_seo_blog_keyword FROM tapcrm_app;
