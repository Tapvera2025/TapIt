-- Phase 2: durable Yjs state for collaborative content documents.
CREATE TABLE seo_content_collaboration_state (
  organization_id uuid NOT NULL,
  document_id uuid NOT NULL,
  y_state bytea NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, document_id),
  FOREIGN KEY (organization_id, document_id)
    REFERENCES seo_content_documents(organization_id, id) ON DELETE CASCADE
);
SELECT apply_tenant_rls('seo_content_collaboration_state');
GRANT SELECT, INSERT, UPDATE ON seo_content_collaboration_state TO tapcrm_app;
REVOKE DELETE ON seo_content_collaboration_state FROM tapcrm_app;
