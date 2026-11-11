-- Company-wide sign-ins for every platform.
--
-- 0126 let a company sign in to Google Business Profile once and assign the
-- locations it manages to CRM clients. Agencies hold their clients' Facebook
-- Pages, Instagram accounts, LinkedIn pages and YouTube channels the same way:
-- a few staff logins, each managing many clients. This widens company
-- connections to those platforms, and lets a Google sign-in also bring the
-- Search Console properties it can read, each assigned to one client.
--
-- Additive and forward-only (tools/migrate.ts). Client-scoped connections and
-- existing Google Business Profile company connections are unchanged.

-- ---------------------------------------------------------------------
-- 1. Platforms a company sign-in can be for. One Meta sign-in is stored as
--    'facebook' and lists both the Pages and the Instagram accounts linked
--    to them.
-- ---------------------------------------------------------------------
ALTER TABLE social_connection DROP CONSTRAINT social_connection_company_platform;
ALTER TABLE social_connection
  ADD CONSTRAINT social_connection_company_platform
    CHECK (client_id IS NOT NULL OR platform IN ('google_business', 'facebook', 'linkedin', 'youtube'));

-- The display name of the signed-in platform account. Meta, LinkedIn and
-- YouTube do not share an email with this integration, so the name is what
-- people recognise the sign-in by.
ALTER TABLE social_connection ADD COLUMN external_account_name text;

-- ---------------------------------------------------------------------
-- 2. What a company sign-in can list.
-- ---------------------------------------------------------------------
ALTER TABLE social_connection_location DROP CONSTRAINT social_connection_location_platform_check;
ALTER TABLE social_connection_location
  ADD CONSTRAINT social_connection_location_platform_check
    CHECK (platform IN ('google_business', 'facebook', 'instagram', 'linkedin', 'youtube', 'search_console'));

-- ---------------------------------------------------------------------
-- 3. Search Console properties are read, never published to, so they are
--    assigned to a client on the property row itself rather than through a
--    social_account.
-- ---------------------------------------------------------------------
ALTER TABLE social_connection_location ADD COLUMN client_id uuid;
ALTER TABLE social_connection_location
  ADD CONSTRAINT social_connection_location_client_fkey
    FOREIGN KEY (organization_id, client_id) REFERENCES client (organization_id, id),
  ADD CONSTRAINT social_connection_location_client_scope
    CHECK (client_id IS NULL OR platform = 'search_console');

-- One client per property at a time, whichever sign-in it is reached through.
CREATE UNIQUE INDEX ux_social_connection_location_property_client
  ON social_connection_location (organization_id, platform, external_id)
  WHERE client_id IS NOT NULL;
CREATE INDEX ix_social_connection_location_client
  ON social_connection_location (organization_id, client_id)
  WHERE client_id IS NOT NULL;
