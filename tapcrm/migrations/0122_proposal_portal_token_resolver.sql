-- =====================================================================
-- 0122 — Sales: SECURITY DEFINER resolver for proposal portal tokens
--
-- Same pattern as 0121 (sales_connector): `proposal_portal_token` is
-- RLS-forced on `organization_id`, but the public portal endpoint
-- resolves the tenant FROM the token row. Without a bypass, the app
-- role cannot see any token at lookup time and every portal visit
-- returns PortalNotFoundError instead of the correct state (Gone /
-- OK). See modules/sales/proposals/portal/token.ts.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.resolve_proposal_portal_token(p_token_hash text)
RETURNS TABLE (
  id              uuid,
  organization_id uuid,
  commercials_id  uuid,
  token_hash      text,
  expires_at      timestamptz,
  revoked_at      timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT t.id,
         t.organization_id,
         t.commercials_id,
         t.token_hash,
         t.expires_at,
         t.revoked_at
    FROM public.proposal_portal_token AS t
   WHERE t.token_hash = p_token_hash
$$;

REVOKE ALL ON FUNCTION public.resolve_proposal_portal_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_proposal_portal_token(text) TO tapcrm_app;

COMMENT ON FUNCTION public.resolve_proposal_portal_token(text) IS
  'Pre-auth token lookup for the proposal public portal. SECURITY DEFINER by design: the tenant is resolved FROM this row, so RLS cannot be satisfied first.';
