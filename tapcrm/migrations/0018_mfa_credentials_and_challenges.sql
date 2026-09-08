-- =====================================================================
-- 0018 - MFA credentials, challenges, and recovery codes
-- =====================================================================

ALTER TABLE mfa_enrollment
  ADD COLUMN IF NOT EXISTS secret_ciphertext text,
  ADD COLUMN IF NOT EXISTS credential_id text,
  ADD COLUMN IF NOT EXISTS credential_public_key text,
  ADD COLUMN IF NOT EXISTS sign_count bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS transports text[] NOT NULL DEFAULT '{}';

CREATE TABLE mfa_challenge (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id  uuid NOT NULL REFERENCES organization(id),
  user_id          uuid NOT NULL,
  method           text NOT NULL CHECK (method IN ('passkey', 'totp', 'email-otp', 'recovery-code')),
  assurance       text NOT NULL CHECK (assurance IN ('high', 'low')),
  challenge_hash  bytea NOT NULL UNIQUE,
  expires_at      timestamptz NOT NULL,
  consumed_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, user_id) REFERENCES app_user (organization_id, id),
  CHECK (method <> 'email-otp' OR assurance = 'low'),
  CHECK (method IN ('passkey', 'totp', 'recovery-code') OR assurance = 'low')
);

CREATE TABLE mfa_recovery_code (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id  uuid NOT NULL REFERENCES organization(id),
  user_id          uuid NOT NULL,
  code_hash        bytea NOT NULL UNIQUE,
  used_at          timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, user_id) REFERENCES app_user (organization_id, id)
);

SELECT apply_tenant_rls('mfa_challenge');
SELECT apply_tenant_rls('mfa_recovery_code');

GRANT SELECT, INSERT, UPDATE, DELETE ON mfa_challenge, mfa_recovery_code TO tapcrm_app;

CREATE INDEX ix_mfa_challenge_user ON mfa_challenge (organization_id, user_id, expires_at)
  WHERE consumed_at IS NULL;
CREATE INDEX ix_mfa_recovery_user ON mfa_recovery_code (organization_id, user_id)
  WHERE used_at IS NULL;
