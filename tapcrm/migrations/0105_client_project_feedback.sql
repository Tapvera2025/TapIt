CREATE TABLE client_project_feedback (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL REFERENCES organization(id),
  project_id uuid NOT NULL,
  created_by uuid NOT NULL,
  area text NOT NULL CHECK (area IN ('keyword-tracker', 'blog-updates', 'off-page-seo', 'screenshots')),
  note text NOT NULL CHECK (char_length(trim(note)) BETWEEN 1 AND 5000),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, project_id) REFERENCES project(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, created_by) REFERENCES app_user(organization_id, id)
);
CREATE INDEX client_project_feedback_project_area_created_idx ON client_project_feedback (organization_id, project_id, area, created_at DESC, id DESC);
SELECT apply_tenant_rls('client_project_feedback');
