-- =====================================================================
-- 0019 - Identity security state
-- =====================================================================

ALTER TABLE app_user
  ADD COLUMN IF NOT EXISTS locked_until timestamptz;

ALTER TABLE session
  ADD COLUMN IF NOT EXISTS country_code text;

CREATE TABLE password_reset_token (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id  uuid NOT NULL REFERENCES organization(id),
  user_id          uuid NOT NULL,
  token_hash       bytea NOT NULL UNIQUE,
  expires_at       timestamptz NOT NULL,
  used_at          timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, user_id) REFERENCES app_user (organization_id, id)
);

CREATE TABLE email_verification_token (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id  uuid NOT NULL REFERENCES organization(id),
  user_id          uuid NOT NULL,
  token_hash       bytea NOT NULL UNIQUE,
  expires_at       timestamptz NOT NULL,
  used_at          timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, user_id) REFERENCES app_user (organization_id, id)
);

SELECT apply_tenant_rls('password_reset_token');
SELECT apply_tenant_rls('email_verification_token');

GRANT SELECT, INSERT, UPDATE, DELETE ON password_reset_token, email_verification_token TO tapcrm_app;
