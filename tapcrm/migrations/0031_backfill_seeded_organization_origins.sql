-- Existing installations received the standard starter rows before the
-- origin columns existed. Mark only the known seed organization/template rows
-- so rerunning the shared bootstrap remains idempotent without reclassifying
-- arbitrary tenant-customized records.
WITH seed_org AS (
  SELECT id FROM organization WHERE lower(code) = 'tapvera'
)
UPDATE department d
SET is_seeded = true
FROM seed_org o
WHERE d.organization_id = o.id
  AND d.code IN ('hr', 'sales', 'projects', 'development', 'finance');

WITH seed_org AS (
  SELECT id FROM organization WHERE lower(code) = 'tapvera'
)
UPDATE position p
SET is_seeded = true
FROM seed_org o
WHERE p.organization_id = o.id
  AND p.code IN (
    'hr', 'hr-executive', 'sales-head', 'sales-team-lead',
    'sales-supervisor', 'sales-agent', 'project-manager', 'dev-dept-head',
    'developer-team-manager', 'digital-marketing-manager',
    'content-team-manager', 'developer', 'marketing-executive',
    'content-writer', 'finance-manager', 'accountant'
  );

WITH seed_org AS (
  SELECT id FROM organization WHERE lower(code) = 'tapvera'
)
UPDATE designation d
SET is_seeded = true
FROM seed_org o
WHERE d.organization_id = o.id
  AND d.name IN ('Developer', 'Marketing Executive', 'Content Writer');
