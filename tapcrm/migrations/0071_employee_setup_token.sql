-- =====================================================================
-- 0071 - Employee Account Setup Link Token
-- =====================================================================

CREATE TABLE employee_setup_token (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id  uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  user_id          uuid NOT NULL,
  token_hash       bytea NOT NULL UNIQUE,
  purpose          text NOT NULL DEFAULT 'employee_password_setup',
  expires_at       timestamptz NOT NULL,
  used_at          timestamptz,
  revoked_at       timestamptz,
  created_by       uuid NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, user_id) REFERENCES app_user (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, created_by) REFERENCES app_user (organization_id, id)
);

SELECT apply_tenant_rls('employee_setup_token');

GRANT SELECT, INSERT, UPDATE, DELETE ON employee_setup_token TO tapcrm_app;

CREATE INDEX ix_employee_setup_token_lookup ON employee_setup_token (token_hash)
  WHERE used_at IS NULL AND revoked_at IS NULL;
CREATE INDEX ix_employee_setup_token_user_purpose ON employee_setup_token (organization_id, user_id, purpose)
  WHERE used_at IS NULL AND revoked_at IS NULL;
