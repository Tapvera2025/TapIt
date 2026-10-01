-- =====================================================================
-- 0054 — Organization team lifecycle status
--
-- Existing teams remain active. Territories use this shared team state when
-- validating a target Sales Team; no duplicate Sales availability state is
-- introduced.
-- =====================================================================

ALTER TABLE team
  ADD COLUMN status text NOT NULL DEFAULT 'active'
  CHECK (status IN ('active', 'inactive'));

CREATE INDEX ix_team_org_status ON team (organization_id, status);
