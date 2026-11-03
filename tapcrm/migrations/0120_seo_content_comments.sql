-- Phase 2 review comments and editorial suggestions. Yjs-relative anchors stay stable
-- as collaborators edit surrounding text; their client marks live in the Yjs document.
CREATE TABLE seo_content_comment_threads (
  organization_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL,
  created_by uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('comment','suggestion')),
  anchor_from text NOT NULL CHECK (length(anchor_from) BETWEEN 1 AND 512),
  anchor_to text NOT NULL CHECK (length(anchor_to) BETWEEN 1 AND 512),
  quoted_text text NOT NULL CHECK (length(quoted_text) BETWEEN 1 AND 2000),
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 5000),
  suggested_text text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','accepted','rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, id),
  FOREIGN KEY (organization_id, document_id)
    REFERENCES seo_content_documents(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, created_by)
    REFERENCES app_user(organization_id, id),
  CHECK ((kind = 'suggestion' AND suggested_text IS NOT NULL) OR
         (kind = 'comment' AND suggested_text IS NULL))
);
CREATE INDEX seo_content_comment_threads_document
  ON seo_content_comment_threads(organization_id, document_id, created_at DESC);
SELECT apply_tenant_rls('seo_content_comment_threads');
GRANT SELECT, INSERT, UPDATE ON seo_content_comment_threads TO tapcrm_app;
REVOKE DELETE ON seo_content_comment_threads FROM tapcrm_app;

INSERT INTO registry_action
(action,module,resource,domain,sensitive,approval_bearing,initiator_field,position_grantable,delegation_allowed,super_admin_only)
VALUES
('seo:comment-content','seo-intelligence','seo_content_document','business',false,false,NULL,true,true,false)
ON CONFLICT (action) DO NOTHING;
