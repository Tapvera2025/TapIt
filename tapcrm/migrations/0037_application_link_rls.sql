-- =====================================================================
-- 0037 — Application Link RLS & Public Resolver
--
-- Apply tenant RLS to recruitment_application_link (CI-33) and
-- create SECURITY DEFINER resolver for public candidate applications.
-- =====================================================================

SELECT apply_tenant_rls('recruitment_application_link');

CREATE OR REPLACE FUNCTION resolve_recruitment_application_link(p_token text)
RETURNS TABLE (
  id               uuid,
  organization_id  uuid,
  requisition_id   uuid,
  token            text,
  status           text,
  expires_at       timestamptz,
  created_by       uuid,
  created_at       timestamptz,
  updated_at       timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, organization_id, requisition_id, token, status, expires_at, created_by, created_at, updated_at
  FROM recruitment_application_link
  WHERE token = p_token;
$$;

GRANT EXECUTE ON FUNCTION resolve_recruitment_application_link(text) TO tapcrm_app;
