-- =====================================================================
-- 0035_designation_department.sql
-- Designations belong to exactly one department.
-- =====================================================================
-- A designation is a job title within a department (e.g. "Developer" in
-- Development, "Content Writer" in Sales). The employee-creation flow
-- filters designations by the chosen department, and picking a
-- designation first auto-selects the department it belongs to.
--
-- Existing seeded designations are backfilled by name:
--   Developer            → Development
--   Marketing Executive  → Sales
--   Content Writer       → Sales
--
-- Any custom designations that predate this migration are backfilled to
-- the organisation's first active department (deterministic by code).
-- After backfill the column becomes NOT NULL with a same-tenant FK.

BEGIN;

-- ---------------------------------------------------------------------
-- Add the column nullable for backfill.
-- ---------------------------------------------------------------------
ALTER TABLE designation
  ADD COLUMN department_id uuid;

-- ---------------------------------------------------------------------
-- Backfill seeded designations by name.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  org_row RECORD;
  dept_development uuid;
  dept_sales uuid;
BEGIN
  FOR org_row IN SELECT id FROM organization LOOP
    SELECT id INTO dept_development
      FROM department
      WHERE organization_id = org_row.id AND code = 'development';
    SELECT id INTO dept_sales
      FROM department
      WHERE organization_id = org_row.id AND code = 'sales';

    IF dept_development IS NOT NULL THEN
      UPDATE designation
        SET department_id = dept_development
        WHERE organization_id = org_row.id
          AND department_id IS NULL
          AND lower(name) = lower('Developer');
    END IF;

    IF dept_sales IS NOT NULL THEN
      UPDATE designation
        SET department_id = dept_sales
        WHERE organization_id = org_row.id
          AND department_id IS NULL
          AND lower(name) IN (lower('Marketing Executive'), lower('Content Writer'));
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- Fallback backfill for any remaining custom designations.
-- ---------------------------------------------------------------------
-- Assigns each to its organisation's first active department (by code).
-- If an organisation has no active department the migration stops — an
-- unassignable designation means the schema was corrupt before this
-- change and cannot be silently rescued.
DO $$
DECLARE
  designation_row RECORD;
  fallback_department uuid;
BEGIN
  FOR designation_row IN
    SELECT id, organization_id FROM designation WHERE department_id IS NULL
  LOOP
    SELECT id INTO fallback_department
      FROM department
      WHERE organization_id = designation_row.organization_id
        AND status = 'active'
      ORDER BY code
      LIMIT 1;
    IF fallback_department IS NULL THEN
      RAISE EXCEPTION 'No active department found to backfill designation % in org %',
        designation_row.id, designation_row.organization_id;
    END IF;
    UPDATE designation SET department_id = fallback_department
      WHERE id = designation_row.id;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- Enforce NOT NULL and add same-tenant FK.
-- ---------------------------------------------------------------------
ALTER TABLE designation
  ALTER COLUMN department_id SET NOT NULL,
  ADD CONSTRAINT designation_department_fk
    FOREIGN KEY (organization_id, department_id)
      REFERENCES department (organization_id, id);

CREATE INDEX ix_designation_org_department
  ON designation (organization_id, department_id);

COMMIT;
