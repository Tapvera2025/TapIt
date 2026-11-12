-- =====================================================================
-- 0121 — Sales: SECURITY DEFINER resolver for pre-auth webhook routing
--
-- Problem
--   `sales_connector` is RLS-forced on `organization_id`. Webhook routes
--   (/api/webhooks/website/:connectorId, Meta leadgen, GBP, WhatsApp)
--   arrive BEFORE any tenant context exists — the whole point of the
--   lookup is to DISCOVER the owning org, so RLS cannot be satisfied
--   first.
--
--   The request-path role (`tapcrm_app`) correctly has no BYPASSRLS and
--   must not hold schema-owner credentials (PG-3, TECH 4.2.1). Routing
--   the lookup through `getMigrationPool()` would violate that invariant,
--   because the API container intentionally does not carry the migrator
--   credential.
--
-- Fix
--   Two SECURITY DEFINER functions owned by the migrator, callable by
--   the app role. They return exactly the shape the four adapters need
--   (website: by id; meta/gbp/whatsapp: by kind + external_account_id)
--   so no column added to `sales_connector` later leaks accidentally.
--
--   Each function has `search_path = ''` so a user-created table in a
--   writable schema cannot shadow `public.sales_connector`.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.resolve_sales_connector_by_id(p_id uuid)
RETURNS TABLE (
  id                  uuid,
  organization_id     uuid,
  kind                text,
  status              text,
  external_account_id text,
  config              jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT c.id,
         c.organization_id,
         c.kind,
         c.status,
         c.external_account_id,
         c.config
    FROM public.sales_connector AS c
   WHERE c.id = p_id
$$;

REVOKE ALL ON FUNCTION public.resolve_sales_connector_by_id(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_sales_connector_by_id(uuid) TO tapcrm_app;

COMMENT ON FUNCTION public.resolve_sales_connector_by_id(uuid) IS
  'Pre-auth connector lookup for webhook routing (website kind). SECURITY DEFINER by design: webhook has no tenant context yet.';

CREATE OR REPLACE FUNCTION public.resolve_sales_connectors_by_external(
  p_kind              text,
  p_external_ids      text[]
)
RETURNS TABLE (
  id                  uuid,
  organization_id     uuid,
  kind                text,
  status              text,
  external_account_id text,
  config              jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT c.id,
         c.organization_id,
         c.kind,
         c.status,
         c.external_account_id,
         c.config
    FROM public.sales_connector AS c
   WHERE c.kind                = p_kind
     AND c.external_account_id = ANY(p_external_ids)
$$;

REVOKE ALL ON FUNCTION public.resolve_sales_connectors_by_external(text, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_sales_connectors_by_external(text, text[]) TO tapcrm_app;

COMMENT ON FUNCTION public.resolve_sales_connectors_by_external(text, text[]) IS
  'Pre-auth connector lookup for webhook routing (meta, gbp, whatsapp). SECURITY DEFINER by design: webhook has no tenant context yet.';

-- Webhook ingestion persists contacts, leads and companies; each has a
-- composite FK (organization_id, created_by) → app_user. The webhook has no
-- human actor, and there is no global system user (the composite FK forbids
-- one). Attribute to the org's first active super-admin instead.
CREATE OR REPLACE FUNCTION public.resolve_webhook_actor(p_organization_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT u.id
    FROM public.app_user AS u
   WHERE u.organization_id = p_organization_id
     AND u.status          = 'active'
     AND u.account_type   IN ('super-admin', 'company_admin', 'admin')
   ORDER BY CASE u.account_type
              WHEN 'super-admin'   THEN 0
              WHEN 'company_admin' THEN 1
              WHEN 'admin'         THEN 2
              ELSE 3
            END,
            u.created_at
   LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.resolve_webhook_actor(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_webhook_actor(uuid) TO tapcrm_app;

COMMENT ON FUNCTION public.resolve_webhook_actor(uuid) IS
  'Pre-auth actor resolution for webhook ingestion. Returns a real app_user id in the org (admin preferred) so composite FKs (organization_id, created_by) on contact/company/lead inserts succeed. SECURITY DEFINER so it is callable before org GUC is set.';
