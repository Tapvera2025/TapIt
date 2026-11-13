-- Content Studio phase 1. Applied migrations remain immutable.
ALTER TABLE seo_content_briefs ADD CONSTRAINT seo_content_briefs_org_id_unique UNIQUE (organization_id, id);
ALTER TABLE seo_content_briefs ADD COLUMN target_audience text NOT NULL DEFAULT '';
ALTER TABLE seo_content_briefs ADD COLUMN requested_keywords text[] NOT NULL DEFAULT '{}';
ALTER TABLE seo_content_briefs ADD COLUMN source_notes text NOT NULL DEFAULT '';
ALTER TABLE seo_content_briefs ADD COLUMN meta_description text NOT NULL DEFAULT '';
ALTER TABLE seo_content_briefs ADD COLUMN due_date date;

CREATE TABLE seo_content_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organization(id),
  site_id uuid NOT NULL,
  brief_id uuid NOT NULL UNIQUE,
  owner_id uuid NOT NULL,
  reviewer_id uuid,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','in_review','approved','archived')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  approved_version integer,
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, site_id) REFERENCES seo_sites(organization_id, id),
  FOREIGN KEY (organization_id, brief_id) REFERENCES seo_content_briefs(organization_id, id),
  FOREIGN KEY (organization_id, owner_id) REFERENCES app_user(organization_id, id),
  FOREIGN KEY (organization_id, reviewer_id) REFERENCES app_user(organization_id, id),
  CHECK (reviewer_id IS NULL OR reviewer_id <> owner_id),
  CHECK ((status = 'approved' AND approved_version = version) OR (status <> 'approved' AND approved_version IS NULL))
);
CREATE INDEX seo_content_documents_site ON seo_content_documents(organization_id, site_id, updated_at DESC);
CREATE TABLE seo_content_versions (
  organization_id uuid NOT NULL,
  document_id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  snapshot jsonb NOT NULL,
  author_id uuid NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, document_id, version),
  FOREIGN KEY (organization_id, document_id) REFERENCES seo_content_documents(organization_id, id),
  FOREIGN KEY (organization_id, author_id) REFERENCES app_user(organization_id, id)
);
CREATE TABLE seo_content_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  document_id uuid NOT NULL,
  version integer NOT NULL,
  actor_id uuid NOT NULL,
  action text NOT NULL,
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, document_id, version) REFERENCES seo_content_versions(organization_id, document_id, version),
  FOREIGN KEY (organization_id, actor_id) REFERENCES app_user(organization_id, id)
);
CREATE TABLE seo_content_brand_versions (
  organization_id uuid NOT NULL REFERENCES organization(id),
  scope_id uuid NOT NULL,
  client_id uuid,
  site_id uuid,
  version integer NOT NULL CHECK (version > 0),
  guidance text NOT NULL,
  author_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, scope_id, version),
  CHECK ((client_id IS NOT NULL AND site_id IS NULL AND scope_id = client_id) OR
         (site_id IS NOT NULL AND client_id IS NULL AND scope_id = site_id)),
  FOREIGN KEY (organization_id, client_id) REFERENCES client(organization_id, id),
  FOREIGN KEY (organization_id, site_id) REFERENCES seo_sites(organization_id, id),
  FOREIGN KEY (organization_id, author_id) REFERENCES app_user(organization_id, id)
);
SELECT apply_tenant_rls('seo_content_documents');
SELECT apply_tenant_rls('seo_content_versions');
SELECT apply_tenant_rls('seo_content_events');
SELECT apply_tenant_rls('seo_content_brand_versions');
GRANT SELECT, INSERT, UPDATE ON seo_content_documents TO tapcrm_app;
GRANT SELECT, INSERT ON seo_content_versions, seo_content_events, seo_content_brand_versions TO tapcrm_app;
-- Checkpoints and events are append-only even under the runtime database role.
REVOKE UPDATE, DELETE ON seo_content_versions, seo_content_events, seo_content_brand_versions FROM tapcrm_app;
REVOKE DELETE ON seo_content_documents FROM tapcrm_app;

INSERT INTO registry_action
(action,module,resource,domain,sensitive,approval_bearing,initiator_field,position_grantable,delegation_allowed,super_admin_only)
VALUES
('seo:read-content','seo-intelligence','seo_content_site','business',false,false,NULL,true,true,false),
('seo:create-content','seo-intelligence','seo_content_site','business',false,false,NULL,true,true,false),
('seo:edit-content','seo-intelligence','seo_content_site','business',false,false,NULL,true,true,false),
('seo:review-content','seo-intelligence','seo_content_document','business',true,true,'ownerId',true,false,false),
('seo:export-content','seo-intelligence','seo_content_site','business',true,false,NULL,true,false,false),
('seo:manage-content-brand','seo-intelligence','seo_content_site','business',true,false,NULL,true,false,false)
ON CONFLICT (action) DO NOTHING;
