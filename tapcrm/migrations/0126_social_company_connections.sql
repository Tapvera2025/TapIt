-- Company-wide social connections.
--
-- A company signs in to Google Business Profile ONCE and assigns the locations
-- that Google account manages to its CRM clients. Before this, every client
-- needed its own sign-in. Each sign-in mints a new Google refresh token, and
-- Google keeps at most 100 per account per OAuth client before silently
-- cancelling the oldest, so per-client sign-ins break once an agency grows.
--
-- Additive and forward-only (tools/migrate.ts). Client-scoped connections keep
-- working unchanged: a connection WITH a client_id belongs to that client, a
-- connection WITHOUT one belongs to the whole company.

-- ---------------------------------------------------------------------
-- 1. Company connections. They record which platform account signed in, so a
--    reconnect of the same account updates the same row instead of storing a
--    second token.
-- ---------------------------------------------------------------------
ALTER TABLE social_connection
  ALTER COLUMN client_id DROP NOT NULL,
  ADD COLUMN external_account_id text,
  ADD COLUMN external_account_email text,
  ADD COLUMN last_discovered_at timestamptz,
  ADD COLUMN last_error text;

ALTER TABLE social_connection
  ADD CONSTRAINT social_connection_organization_id_id_key UNIQUE (organization_id, id),
  ADD CONSTRAINT social_connection_company_identity
    CHECK (client_id IS NOT NULL OR btrim(coalesce(external_account_id, '')) <> ''),
  -- Only Google Business Profile supports company-wide connections today.
  ADD CONSTRAINT social_connection_company_platform
    CHECK (client_id IS NOT NULL OR platform = 'google_business');

CREATE UNIQUE INDEX ux_social_connection_company_account
  ON social_connection (organization_id, platform, external_account_id)
  WHERE client_id IS NULL AND status <> 'disconnected';

-- ---------------------------------------------------------------------
-- 2. The locations a company connection can manage, refreshed on every sync.
--    A location that disappears is kept as 'missing' so its assignment and
--    history stay explainable.
-- ---------------------------------------------------------------------
CREATE TABLE social_connection_location (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL REFERENCES organization(id),
  connection_id uuid NOT NULL,
  platform text NOT NULL CHECK (platform IN ('google_business')),
  external_id text NOT NULL,
  name text NOT NULL,
  profile_image_url text,
  capabilities text[] NOT NULL DEFAULT '{}',
  metadata jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'missing')),
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, connection_id, id),
  UNIQUE (connection_id, external_id),
  FOREIGN KEY (organization_id, connection_id) REFERENCES social_connection (organization_id, id)
);
CREATE INDEX ix_social_connection_location_external
  ON social_connection_location (organization_id, platform, external_id);
SELECT apply_tenant_rls('social_connection_location');

-- ---------------------------------------------------------------------
-- 3. Accounts may use a company connection. The old key forced an account's
--    connection to carry the same client_id, which a company connection does
--    not have. Section 5 keeps that rule for client connections.
-- ---------------------------------------------------------------------
ALTER TABLE social_account
  DROP CONSTRAINT social_account_organization_id_client_id_connection_id_fkey;
ALTER TABLE social_account
  ADD CONSTRAINT social_account_connection_fkey
    FOREIGN KEY (organization_id, connection_id) REFERENCES social_connection (organization_id, id);

-- The company location a client account was assigned from. The composite key
-- also guarantees the location belongs to the account's own connection.
ALTER TABLE social_account ADD COLUMN location_id uuid;
ALTER TABLE social_account
  ADD CONSTRAINT social_account_location_fkey
    FOREIGN KEY (organization_id, connection_id, location_id)
    REFERENCES social_connection_location (organization_id, connection_id, id);

-- A company location serves one client at a time. Older client-scoped rows
-- (no location_id) are not affected.
CREATE UNIQUE INDEX ux_social_account_live_company_location
  ON social_account (organization_id, platform, external_id)
  WHERE location_id IS NOT NULL AND status <> 'disconnected';
CREATE INDEX ix_social_account_connection
  ON social_account (organization_id, connection_id);

-- ---------------------------------------------------------------------
-- 4. Company sign-ins start without a client, and company events are audited
--    without one.
-- ---------------------------------------------------------------------
ALTER TABLE social_oauth_state ALTER COLUMN client_id DROP NOT NULL;
ALTER TABLE social_audit_log ALTER COLUMN client_id DROP NOT NULL;

-- ---------------------------------------------------------------------
-- 5. Scope guards. The foreign keys above cannot express "a client connection
--    serves only its own client", so these triggers do.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION social_connection_scope_guard() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NEW.client_id IS DISTINCT FROM OLD.client_id THEN
    RAISE EXCEPTION 'social_connection: a connection keeps the scope it was created with'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER social_connection_scope_guard BEFORE UPDATE OF client_id ON social_connection
  FOR EACH ROW EXECUTE FUNCTION social_connection_scope_guard();

CREATE OR REPLACE FUNCTION social_connection_location_guard() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM social_connection c
    WHERE c.organization_id = NEW.organization_id
      AND c.id = NEW.connection_id
      AND c.client_id IS NULL
  ) THEN
    RAISE EXCEPTION 'social_connection_location: locations belong to a company-wide connection'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER social_connection_location_guard
  BEFORE INSERT OR UPDATE OF connection_id ON social_connection_location
  FOR EACH ROW EXECUTE FUNCTION social_connection_location_guard();

CREATE OR REPLACE FUNCTION social_account_scope_guard() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  connection_client uuid;
BEGIN
  SELECT c.client_id INTO connection_client
  FROM social_connection c
  WHERE c.organization_id = NEW.organization_id AND c.id = NEW.connection_id;
  -- A missing connection is reported by social_account_connection_fkey.
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;
  IF connection_client IS NOT NULL
     AND (connection_client <> NEW.client_id OR NEW.location_id IS NOT NULL) THEN
    RAISE EXCEPTION 'social_account: a client connection serves only its own client'
      USING ERRCODE = 'check_violation';
  END IF;
  IF connection_client IS NULL AND NEW.location_id IS NULL THEN
    RAISE EXCEPTION 'social_account: a company connection serves a client through one of its locations'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER social_account_scope_guard
  BEFORE INSERT OR UPDATE OF client_id, connection_id, location_id ON social_account
  FOR EACH ROW EXECUTE FUNCTION social_account_scope_guard();

-- Trigger functions run when their trigger fires; nothing calls them directly.
REVOKE ALL ON FUNCTION social_connection_scope_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION social_connection_location_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION social_account_scope_guard() FROM PUBLIC;
