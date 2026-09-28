-- =====================================================================
-- 0036 - Correct seeded development designations
-- =====================================================================
-- 0035 backfilled these two seeded designations to Sales. Their canonical
-- template and positions place them in Development, so correct only seeded
-- rows identified by their stable origin key. Custom designations are never
-- moved by this migration.

BEGIN;

UPDATE designation AS designation_row
SET department_id = development_department.id,
    updated_at = now()
FROM department AS development_department
WHERE designation_row.organization_id = development_department.organization_id
  AND development_department.code = 'development'
  AND designation_row.is_seeded = true
  AND designation_row.seed_code IN ('marketing-executive', 'content-writer')
  AND designation_row.department_id IS DISTINCT FROM development_department.id;

COMMIT;
