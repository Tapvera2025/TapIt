-- =====================================================================
-- 0007 — Employee Directory + Secure Invitation Onboarding
--
-- Purpose:
--   - Remove public/self-assigned employee provisioning from the data model.
--   - Store HR employee identity attributes separately from app_user.
--   - Create single-use invitation tokens for controlled employee onboarding.
-- =====================================================================

CREATE TABLE IF NOT EXISTS employee_profile (
  id                uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id   uuid NOT NULL REFERENCES organization(id),
  user_id           uuid NOT NULL,
  employee_id       text NOT NULL,
  contact           text,
  date_of_birth     date,
  gender            text,
  employment_type   text NOT NULL DEFAULT 'full-time'
                      CHECK (employment_type IN ('full-time', 'part-time', 'contract', 'intern', 'temporary')),
  joining_date      date NOT NULL DEFAULT CURRENT_DATE,
  employment_status text NOT NULL DEFAULT 'active'
                      CHECK (employment_status IN ('active', 'on-notice', 'inactive', 'terminated', 'absconded')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, employee_id),
  UNIQUE (organization_id, user_id),
  FOREIGN KEY (organization_id, user_id) REFERENCES app_user (organization_id, id)
);

CREATE TABLE IF NOT EXISTS employee_invitation (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id  uuid NOT NULL REFERENCES organization(id),
  user_id          uuid NOT NULL,
  token_hash       text NOT NULL,
  expires_at       timestamptz NOT NULL,
  accepted_at      timestamptz,
  created_by       uuid NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, token_hash),
  FOREIGN KEY (organization_id, user_id) REFERENCES app_user (organization_id, id),
  FOREIGN KEY (organization_id, created_by) REFERENCES app_user (organization_id, id)
);

SELECT apply_tenant_rls('employee_profile');
SELECT apply_tenant_rls('employee_invitation');

CREATE INDEX IF NOT EXISTS ix_employee_profile_directory
  ON employee_profile (organization_id, employment_status, employee_id);

CREATE INDEX IF NOT EXISTS ix_employee_invitation_lookup
  ON employee_invitation (organization_id, token_hash)
  WHERE accepted_at IS NULL;

-- Existing employee rows receive an immutable employee identifier so the
-- migration is safe against already-seeded/demo data. The generated value is
-- only a migration fallback; all newly-created employees must supply one.
INSERT INTO employee_profile (
  organization_id,
  user_id,
  employee_id,
  joining_date,
  employment_status
)
SELECT
  u.organization_id,
  u.id,
  'EMP-' || UPPER(REPLACE(SUBSTRING(u.id::text, 1, 8), '-', '')),
  CURRENT_DATE,
  'active'
FROM app_user u
WHERE u.account_type = 'employee'
  AND NOT EXISTS (
    SELECT 1
    FROM employee_profile ep
    WHERE ep.organization_id = u.organization_id
      AND ep.user_id = u.id
  );
