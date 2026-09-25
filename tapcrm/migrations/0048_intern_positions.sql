-- =====================================================================
-- 0048 — seeded intern positions
--
-- The organization template is the source of truth for new organizations.
-- This migration backfills only missing seeded rows for existing tenants;
-- policy defaults are provisioned by the same matrix-driven bootstrap
-- reconciler used during organization creation.
-- =====================================================================

WITH intern(code, name, department_code, parent_code) AS (
  VALUES
    ('developer-intern', 'Developer Intern', 'development', 'developer-team-manager'),
    ('content-intern', 'Content Intern', 'development', 'content-team-manager'),
    ('marketing-executive-intern', 'Marketing Executive Intern', 'development', 'digital-marketing-manager'),
    ('hr-intern', 'HR Intern', 'hr', 'hr')
)
INSERT INTO position (
  organization_id, department_id, code, name, organizational_level,
  parent_position_id, is_seeded, status
)
SELECT
  o.id,
  d.id,
  intern.code,
  intern.name,
  10,
  parent.id,
  true,
  'active'
FROM organization o
JOIN intern ON true
JOIN department d
  ON d.organization_id = o.id
 AND d.code = intern.department_code
 AND d.status = 'active'
JOIN position parent
  ON parent.organization_id = o.id
 AND parent.department_id = d.id
 AND parent.code = intern.parent_code
 AND parent.is_seeded = true
 AND parent.status = 'active'
WHERE NOT EXISTS (
  SELECT 1
  FROM position existing
  WHERE existing.organization_id = o.id
    AND existing.code = intern.code
);
