-- =====================================================================
-- 0011 — Store the primary company owner email on the organization profile
-- =====================================================================
ALTER TABLE organization
  ADD COLUMN owner_email text NOT NULL DEFAULT '';
