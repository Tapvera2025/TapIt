-- Client-portal social connections.
--
-- A client can sign in to a social platform from the client portal and choose
-- which of its own accounts (Facebook Pages, Instagram professional accounts,
-- YouTube channels) the agency may publish to. Those sign-ins belong to the
-- client: the client can disconnect them and revoke them at the platform, and
-- the agency must not silently replace or revoke them. Connections the agency
-- makes, whether company-wide or for one client, stay the agency's.
--
-- This records which side made each connection and which surface started each
-- sign-in, and guards both in the database so the application cannot mix them.
--
-- Additive and forward-only (tools/migrate.ts). Every existing row keeps its
-- meaning through the defaults ('agency', 'workspace'). To withdraw the
-- feature, stop granting `social:connect-own-accounts` to client principals;
-- the columns can stay, and rows marked 'client_portal' remain ordinary
-- client-scoped connections that the agency can disconnect.

-- ---------------------------------------------------------------------
-- 1. Who made a connection. A client-portal connection always belongs to
--    one client: it can never be a company-wide (client_id NULL) login.
-- ---------------------------------------------------------------------
ALTER TABLE social_connection
  ADD COLUMN connected_via text NOT NULL DEFAULT 'agency'
    CONSTRAINT social_connection_connected_via_check
      CHECK (connected_via IN ('agency', 'client_portal'));
ALTER TABLE social_connection
  ADD CONSTRAINT social_connection_client_portal_scope
    CHECK (connected_via = 'agency' OR client_id IS NOT NULL);

-- ---------------------------------------------------------------------
-- 2. Which surface started a sign-in. A sign-in started in the client portal
--    can only be completed in the client portal, and the reverse.
-- ---------------------------------------------------------------------
ALTER TABLE social_oauth_state
  ADD COLUMN surface text NOT NULL DEFAULT 'workspace'
    CONSTRAINT social_oauth_state_surface_check
      CHECK (surface IN ('workspace', 'client_portal'));
ALTER TABLE social_oauth_state
  ADD CONSTRAINT social_oauth_state_client_portal_scope
    CHECK (surface = 'workspace' OR client_id IS NOT NULL);

-- ---------------------------------------------------------------------
-- 3. Guards. A CHECK cannot look at app_user, so these triggers make sure a
--    client-portal row was created by a login of that same client, and that a
--    connection never changes origin after it is created.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION social_connection_origin_guard() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.connected_via IS DISTINCT FROM OLD.connected_via THEN
    RAISE EXCEPTION 'social_connection: a connection keeps the origin it was created with'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.connected_via = 'client_portal' AND NOT EXISTS (
    SELECT 1 FROM app_user u
    WHERE u.organization_id = NEW.organization_id
      AND u.id = NEW.created_by
      AND u.account_type = 'client'
      AND u.client_id = NEW.client_id
  ) THEN
    RAISE EXCEPTION 'social_connection: a client-portal connection is made by a login of that client'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER social_connection_origin_guard
  BEFORE INSERT OR UPDATE OF connected_via, created_by, client_id ON social_connection
  FOR EACH ROW EXECUTE FUNCTION social_connection_origin_guard();

CREATE OR REPLACE FUNCTION social_oauth_state_surface_guard() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.surface IS DISTINCT FROM OLD.surface THEN
    RAISE EXCEPTION 'social_oauth_state: a sign-in keeps the surface it was started from'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.surface = 'client_portal' AND NOT EXISTS (
    SELECT 1 FROM app_user u
    WHERE u.organization_id = NEW.organization_id
      AND u.id = NEW.created_by
      AND u.account_type = 'client'
      AND u.client_id = NEW.client_id
  ) THEN
    RAISE EXCEPTION 'social_oauth_state: a client-portal sign-in is started by a login of that client'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER social_oauth_state_surface_guard
  BEFORE INSERT OR UPDATE OF surface, created_by, client_id ON social_oauth_state
  FOR EACH ROW EXECUTE FUNCTION social_oauth_state_surface_guard();

-- Trigger functions run when their trigger fires; nothing calls them directly.
REVOKE ALL ON FUNCTION social_connection_origin_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION social_oauth_state_surface_guard() FROM PUBLIC;
