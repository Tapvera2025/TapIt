-- =====================================================================
-- 0005 — Identity Hardening
--
-- Purpose:
--   - Password reset tokens (ID-11, ID-12)
--   - MFA single-use recovery codes (ID-5c)
--   - Email verification tokens (ID-12)
--   - Identity indexes and tenant RLS enforcement
-- =====================================================================

-- ---------------------------------------------------------------------
-- Password reset tokens — ID-11
-- Single-use tokens with 30-minute expiry; consumption invalidates sessions.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS password_reset_token (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id  uuid NOT NULL REFERENCES organization(id),
  user_id          uuid NOT NULL,
  token_hash       text NOT NULL,
  expires_at       timestamptz NOT NULL,
  used_at          timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, token_hash),
  FOREIGN KEY (organization_id, user_id) REFERENCES app_user (organization_id, id)
);

-- ---------------------------------------------------------------------
-- MFA single-use recovery codes — ID-5c
-- Issued once at enrolment, single-use, hashed at rest.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mfa_recovery_code (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id  uuid NOT NULL REFERENCES organization(id),
  user_id          uuid NOT NULL,
  code_hash        text NOT NULL,
  used_at          timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, user_id, code_hash),
  FOREIGN KEY (organization_id, user_id) REFERENCES app_user (organization_id, id)
);

-- ---------------------------------------------------------------------
-- Email verification tokens — ID-12
-- Required for account creation verification before password resets can be used.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS email_verification_token (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id  uuid NOT NULL REFERENCES organization(id),
  user_id          uuid NOT NULL,
  token_hash       text NOT NULL,
  expires_at       timestamptz NOT NULL,
  verified_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, token_hash),
  FOREIGN KEY (organization_id, user_id) REFERENCES app_user (organization_id, id)
);

-- ---------------------------------------------------------------------
-- Apply RLS on new tenant tables
-- ---------------------------------------------------------------------
SELECT apply_tenant_rls('password_reset_token');
SELECT apply_tenant_rls('mfa_recovery_code');
SELECT apply_tenant_rls('email_verification_token');

-- ---------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS ix_password_reset_token_lookup
  ON password_reset_token (organization_id, token_hash)
  WHERE used_at IS NULL;

CREATE INDEX IF NOT EXISTS ix_mfa_recovery_code_lookup
  ON mfa_recovery_code (organization_id, user_id, code_hash)
  WHERE used_at IS NULL;

CREATE INDEX IF NOT EXISTS ix_email_verification_lookup
  ON email_verification_token (organization_id, token_hash)
  WHERE verified_at IS NULL;

CREATE INDEX IF NOT EXISTS ix_geofence_assignment_user
  ON geofence_assignment (organization_id, user_id);

CREATE INDEX IF NOT EXISTS ix_geofence_location_org
  ON geofence_location (organization_id);
