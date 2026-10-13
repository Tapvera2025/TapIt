CREATE TABLE project_screenshot (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL REFERENCES organization(id),
  project_id uuid NOT NULL,
  title text NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 200),
  description text,
  original_filename text NOT NULL CHECK (length(trim(original_filename)) BETWEEN 1 AND 255),
  mime_type text NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp')),
  size_bytes bigint NOT NULL CHECK (size_bytes > 0),
  storage_key text NOT NULL,
  uploaded_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  deleted_by uuid,
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, storage_key),
  FOREIGN KEY (organization_id, project_id) REFERENCES project(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, uploaded_by) REFERENCES app_user(organization_id, id),
  FOREIGN KEY (organization_id, deleted_by) REFERENCES app_user(organization_id, id)
);
CREATE INDEX project_screenshot_list_idx ON project_screenshot (organization_id, project_id, created_at DESC) WHERE deleted_at IS NULL;
SELECT apply_tenant_rls('project_screenshot');
GRANT SELECT, INSERT, UPDATE ON project_screenshot TO tapcrm_app;
