-- =====================================================================
-- 0034_employee_id.sql
-- ED-3: "Employee ID is unique, uppercase and immutable after creation."
-- =====================================================================
-- The employee ID is a human-facing identifier separate from the uuid
-- primary key. It is uppercase, unique per organization for employees,
-- and never changes once an employee row exists.
--
-- Auto-generation uses a per-org counter locked FOR UPDATE at creation
-- time (the same pattern as invoice numbering — TECH.md §9.1 — but
-- WITHOUT the gapless requirement, so callers may also supply their own
-- value when migrating from a legacy HRMS).
--
-- Immutability is enforced at the application layer (the update paths
-- omit employee_id). Adding an UPDATE trigger to reject changes belongs
-- in a follow-up if we discover a path that mutates it.

BEGIN;

-- ---------------------------------------------------------------------
-- Per-organization prefix and counter for auto-generation.
-- ---------------------------------------------------------------------
-- The prefix is 1–10 uppercase alphanumeric characters (default 'EMP').
-- The counter starts at 1 and only ever increments; a rolled-back
-- allocation is fine because gaps are acceptable for this identifier.
ALTER TABLE organization
  ADD COLUMN employee_id_prefix text NOT NULL DEFAULT 'EMP',
  ADD COLUMN employee_id_next_number bigint NOT NULL DEFAULT 1,
  ADD CONSTRAINT organization_employee_id_prefix_format
    CHECK (employee_id_prefix ~ '^[A-Z0-9]{1,10}$'),
  ADD CONSTRAINT organization_employee_id_next_number_positive
    CHECK (employee_id_next_number >= 1);

-- ---------------------------------------------------------------------
-- employee_id column on app_user.
-- ---------------------------------------------------------------------
-- Nullable at the column level because super-admin, client and service
-- accounts do not carry one; the CHECK below requires it for employees.
-- Format: uppercase alphanumeric with hyphens, 1–50 characters, starting
-- with alphanumeric.
ALTER TABLE app_user
  ADD COLUMN employee_id text,
  ADD CONSTRAINT app_user_employee_id_format
    CHECK (
      employee_id IS NULL
      OR (employee_id = upper(employee_id) AND employee_id ~ '^[A-Z0-9][A-Z0-9-]{0,49}$')
    );

-- ---------------------------------------------------------------------
-- Backfill any existing employees before enforcing NOT NULL.
-- ---------------------------------------------------------------------
-- Runs once per organization, in creation order, so early employees get
-- the lower numbers. The counter is advanced to match, so future
-- allocations continue from the next value.
DO $$
DECLARE
  org_row RECORD;
  emp_row RECORD;
  next_num bigint;
  formatted text;
BEGIN
  FOR org_row IN SELECT id, employee_id_prefix FROM organization LOOP
    SELECT employee_id_next_number INTO next_num
      FROM organization WHERE id = org_row.id;
    FOR emp_row IN
      SELECT id FROM app_user
      WHERE organization_id = org_row.id
        AND account_type = 'employee'
        AND employee_id IS NULL
      ORDER BY created_at, id
    LOOP
      formatted := org_row.employee_id_prefix || '-' || lpad(next_num::text, 5, '0');
      UPDATE app_user SET employee_id = formatted WHERE id = emp_row.id;
      next_num := next_num + 1;
    END LOOP;
    UPDATE organization SET employee_id_next_number = next_num WHERE id = org_row.id;
  END LOOP;
END $$;

-- ED-3: an employee always carries an employee_id. Enforced after
-- backfill so the constraint validates against the whole table.
ALTER TABLE app_user
  ADD CONSTRAINT app_user_employee_id_required
    CHECK (account_type <> 'employee' OR employee_id IS NOT NULL);

-- ---------------------------------------------------------------------
-- Uniqueness scoped to organization for employees.
-- ---------------------------------------------------------------------
-- Partial index because only employees carry the value. Non-employee
-- rows (super-admin, service, client) are excluded from the uniqueness
-- constraint.
CREATE UNIQUE INDEX ux_app_user_employee_id
  ON app_user (organization_id, employee_id)
  WHERE account_type = 'employee' AND employee_id IS NOT NULL;

COMMIT;
