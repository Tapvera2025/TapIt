-- =====================================================================
-- 0004 — Platform authentication
-- Tapvera Master Admin lives outside tenant identity.
-- =====================================================================
CREATE TABLE platform_user (
  id                  uuid PRIMARY KEY DEFAULT uuidv7(),
  email               citext NOT NULL UNIQUE,
  full_name           text NOT NULL,
  password_hash       text NOT NULL,
  role                text NOT NULL DEFAULT 'MASTER_ADMIN'
                        CHECK (role IN ('MASTER_ADMIN')),
  status              text NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'locked', 'disabled')),
  session_version     integer NOT NULL DEFAULT 1,
  email_verified_at   timestamptz,
  mfa_required        boolean NOT NULL DEFAULT true,
  last_login_at       timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE platform_session (
  id                  uuid PRIMARY KEY DEFAULT uuidv7(),
  platform_user_id    uuid NOT NULL REFERENCES platform_user(id),
  session_version     integer NOT NULL,
  device_label        text,
  ip                  inet,
  user_agent          text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  last_active_at      timestamptz NOT NULL DEFAULT now(),
  expires_at          timestamptz NOT NULL,
  revoked_at          timestamptz
);

CREATE INDEX ix_platform_session_user ON platform_session(platform_user_id, revoked_at, expires_at);

CREATE TABLE platform_refresh_token (
  id                  uuid PRIMARY KEY DEFAULT uuidv7(),
  session_id          uuid NOT NULL REFERENCES platform_session(id) ON DELETE CASCADE,
  token_hash          bytea NOT NULL UNIQUE,
  family_id           uuid NOT NULL,
  parent_id           uuid REFERENCES platform_refresh_token(id),
  used_at             timestamptz,
  expires_at          timestamptz NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ix_platform_refresh_family ON platform_refresh_token(family_id, expires_at);

GRANT SELECT, INSERT, UPDATE, DELETE ON platform_user, platform_session, platform_refresh_token TO tapcrm_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO tapcrm_app;

CREATE TRIGGER platform_user_updated_at
BEFORE UPDATE ON platform_user
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
