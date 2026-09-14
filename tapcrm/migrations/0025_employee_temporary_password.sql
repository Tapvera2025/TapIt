-- 0025 - Explicit employee temporary-password state
--
-- The state is separate from password hashes and timestamps so a temporary
-- credential can never be inferred from credential material.

ALTER TABLE app_user
  ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN app_user.must_change_password IS
  'Employee must replace the provisioned temporary password before normal CRM access.';
