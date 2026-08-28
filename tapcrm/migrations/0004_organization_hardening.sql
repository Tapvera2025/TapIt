-- =====================================================================
-- 0004 — Organization hardening
--
-- Purpose:
--   Database-level invariants that complement application validation.
--
-- Application validation remains authoritative for rules requiring
-- recursive hierarchy inspection or user/position semantics.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Department
-- ---------------------------------------------------------------------

-- Department codes must remain unique within an organization.
CREATE UNIQUE INDEX IF NOT EXISTS department_organization_code_uq
  ON department (organization_id, code);

-- ---------------------------------------------------------------------
-- Position
-- ---------------------------------------------------------------------

-- Position codes must be unique inside an organization.
CREATE UNIQUE INDEX IF NOT EXISTS position_organization_code_uq
  ON position (organization_id, code);

-- ---------------------------------------------------------------------
-- Team
-- ---------------------------------------------------------------------

-- Team names should not be duplicated inside one department.
CREATE UNIQUE INDEX IF NOT EXISTS team_department_name_uq
  ON team (organization_id, department_id, lower(name));

-- ---------------------------------------------------------------------
-- Designation
-- ---------------------------------------------------------------------

CREATE UNIQUE INDEX IF NOT EXISTS designation_organization_name_uq
  ON designation (organization_id, lower(name));

-- ---------------------------------------------------------------------
-- Policy
-- ---------------------------------------------------------------------

CREATE UNIQUE INDEX IF NOT EXISTS position_policy_action_uq
  ON position_policy (organization_id, position_id, action);

-- ---------------------------------------------------------------------
-- Useful indexes for organization graph queries
-- ---------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS position_department_idx
  ON position (organization_id, department_id);

CREATE INDEX IF NOT EXISTS position_parent_idx
  ON position (organization_id, parent_position_id);

CREATE INDEX IF NOT EXISTS team_department_idx
  ON team (organization_id, department_id);

CREATE INDEX IF NOT EXISTS team_parent_idx
  ON team (organization_id, parent_team_id);

CREATE INDEX IF NOT EXISTS app_user_department_idx
  ON app_user (organization_id, department_id);

CREATE INDEX IF NOT EXISTS app_user_team_idx
  ON app_user (organization_id, team_id);

CREATE INDEX IF NOT EXISTS app_user_position_idx
  ON app_user (organization_id, position_id);

CREATE INDEX IF NOT EXISTS app_user_reports_to_idx
  ON app_user (organization_id, reports_to);

-- ---------------------------------------------------------------------
-- Team hierarchy safety
-- ---------------------------------------------------------------------

ALTER TABLE team
  DROP CONSTRAINT IF EXISTS team_kind_parent_check;

ALTER TABLE team
  ADD CONSTRAINT team_kind_parent_check
  CHECK (
    (kind = 'sales-pool' AND parent_team_id IS NOT NULL)
    OR
    (kind IN ('sales-team', 'dev-subteam') AND parent_team_id IS NULL)
  );

-- ---------------------------------------------------------------------
-- Development sub-team limit is application-enforced.
--
-- PostgreSQL CHECK constraints cannot count sibling rows, so the
-- "exactly three dev-subteams" invariant remains in validation.ts.
-- ---------------------------------------------------------------------