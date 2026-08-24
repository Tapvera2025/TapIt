-- =====================================================================
-- 0001 — Foundation: roles, tenancy, and the RLS pattern
--
-- TECH.md PG-3, PG-4, TN-1..TN-4, §4.2.1, §4.4.
--
-- MT-1: "Every tenant-owned record carries organizationId, populated FROM THE
-- FIRST MIGRATION. There is no 'add it later' phase."
--
-- Run as the migration/admin role. The application role must never own a table.
-- =====================================================================

-- PostgreSQL 18 provides uuidv7() natively (TECH.md §5.1: "preferred for new
-- identifiers because it provides UUID semantics with time-ordered locality").
-- pgcrypto is still needed for digest() in the audit hash chain.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
-- citext: ID-1 email comparison is case-insensitive by nature.
CREATE EXTENSION IF NOT EXISTS citext;

-- Fallback for PostgreSQL < 18, so local and CI environments on 16/17 still
-- work. On 18 the native function wins and this is never created.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'uuidv7') THEN
    CREATE FUNCTION uuidv7() RETURNS uuid
      LANGUAGE sql VOLATILE PARALLEL SAFE
      AS $fn$ SELECT gen_random_uuid() $fn$;
    COMMENT ON FUNCTION uuidv7() IS
      'Compatibility shim for PostgreSQL < 18. Not time-ordered. PG-1 requires 18.x in production.';
  END IF;
END
$$;

-- ---------------------------------------------------------------------
-- Migration bookkeeping. Global, not tenant-owned (TN-3).
-- DP-1: "Migrations are forward-only, recorded, reviewed."
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS schema_migrations (
  version     text PRIMARY KEY,
  applied_at  timestamptz NOT NULL DEFAULT now(),
  checksum    text NOT NULL
);

-- ---------------------------------------------------------------------
-- Roles
--
-- PG-3: "Runtime roles never have BYPASSRLS. Table ownership belongs to a
-- migration/admin role, not the application role."
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tapcrm_app') THEN
    CREATE ROLE tapcrm_app NOLOGIN NOBYPASSRLS;
  END IF;
  -- Belt and braces: if the role already existed, make sure it cannot bypass.
  ALTER ROLE tapcrm_app NOBYPASSRLS;
END
$$;

-- ---------------------------------------------------------------------
-- The tenant.
--
-- `organization` is the tenant root. It is deliberately NOT itself protected by
-- a tenant RLS policy keyed on organization_id — a row cannot gate itself.
-- Access to it goes through platformDb (§4.2.2), which is allow-listed and
-- audited.
-- ---------------------------------------------------------------------
CREATE TABLE organization (
  id           uuid PRIMARY KEY DEFAULT uuidv7(),
  code         text NOT NULL UNIQUE,
  name         text NOT NULL,
  -- NF-15: "All times display in the organization's configured timezone
  -- regardless of browser. Storage is UTC."
  timezone     text NOT NULL DEFAULT 'Asia/Kolkata',
  currency     text NOT NULL DEFAULT 'INR',
  status       text NOT NULL DEFAULT 'active'
                 CHECK (status IN ('active', 'suspended')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE organization IS
  'The tenant root. MT-6: Super Admin is scoped to one organization; a cross-tenant operator is a separate principal type and out of scope for this release.';

-- ---------------------------------------------------------------------
-- The tenant-isolation helper.
--
-- TN-7: "Every tenant-owned table has an RLS policy using
-- current_setting('app.organization_id', true). MISSING TENANT CONTEXT
-- THEREFORE MATCHES NO ROWS AND FAILS CLOSED."
--
-- The `true` second argument to current_setting makes it return NULL rather
-- than raising when unset; NULLIF then turns the empty string into NULL; and
-- `organization_id = NULL` is NULL, which is not TRUE, so no row matches.
-- That chain is the whole fail-closed property — do not "simplify" it.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION current_organization_id() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$
    SELECT NULLIF(current_setting('app.organization_id', true), '')::uuid
  $$;

COMMENT ON FUNCTION current_organization_id() IS
  'TN-7. Returns NULL when no tenant context is set, so every RLS policy using it matches zero rows.';

-- ---------------------------------------------------------------------
-- apply_tenant_rls(table)
--
-- Applied to every tenant-owned table. Kept as a function rather than copied
-- per table because a policy that differs subtly between two tables is exactly
-- the defect RLS is meant to eliminate.
--
-- TN-2 / PG-4: ENABLE *and* FORCE. Without FORCE, the table owner bypasses the
-- policy — and the owner is the migration role, which seeds data.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION apply_tenant_rls(target regclass) RETURNS void
  LANGUAGE plpgsql
  AS $$
DECLARE
  policy_name text := format('%s_tenant_isolation', target::text);
BEGIN
  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', target);
  EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', target);
  EXECUTE format('DROP POLICY IF EXISTS %I ON %s', policy_name, target);
  EXECUTE format(
    'CREATE POLICY %I ON %s
       USING (organization_id = current_organization_id())
       WITH CHECK (organization_id = current_organization_id())',
    policy_name, target
  );
  -- WITH CHECK is what prevents INSERT or UPDATE into another tenant. USING
  -- alone would let a write land in the wrong organization and simply become
  -- invisible afterwards, which is worse than a loud failure.
END
$$;

-- ---------------------------------------------------------------------
-- Standard updated_at trigger.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$$;

-- ---------------------------------------------------------------------
-- Grants
--
-- The application role gets DML on tenant tables but never DDL, and never
-- ownership. Append-only tables have UPDATE/DELETE revoked in 0003.
-- ---------------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO tapcrm_app;
GRANT SELECT ON organization TO tapcrm_app;

-- Future tables created by this role default to the same grant, so a new
-- migration cannot forget to make its table readable by the app.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO tapcrm_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO tapcrm_app;
