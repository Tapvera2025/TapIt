CREATE TABLE project_seo_backlink (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL REFERENCES organization(id),
  project_id uuid NOT NULL,
  url text NOT NULL CHECK (length(trim(url)) BETWEEN 1 AND 2000),
  normalized_url text NOT NULL CHECK (length(trim(normalized_url)) BETWEEN 1 AND 2000),
  category text NOT NULL CHECK (category IN ('social_media', 'others')),
  notes text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  deleted_by uuid,
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, project_id) REFERENCES project(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, created_by) REFERENCES app_user(organization_id, id),
  FOREIGN KEY (organization_id, deleted_by) REFERENCES app_user(organization_id, id)
);
CREATE UNIQUE INDEX project_seo_backlink_active_url_uq ON project_seo_backlink (organization_id, project_id, normalized_url) WHERE deleted_at IS NULL;
CREATE INDEX project_seo_backlink_list_idx ON project_seo_backlink (organization_id, project_id, created_at DESC) WHERE deleted_at IS NULL;
SELECT apply_tenant_rls('project_seo_backlink');
GRANT SELECT, INSERT, UPDATE ON project_seo_backlink TO tapcrm_app;
