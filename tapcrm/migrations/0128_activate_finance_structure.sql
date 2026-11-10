-- Finance departments and seeded positions must become assignable when any
-- Finance module is enabled. This also repairs organizations enabled before
-- the provisioning rule was corrected.
WITH finance_organizations AS (
  SELECT DISTINCT om.organization_id
  FROM organization_module om
  JOIN module m ON m.id = om.module_id
  WHERE om.status = 'enabled'
    AND m.key IN ('billing-terms', 'invoicing', 'payments', 'receivables', 'payables', 'accounting')
)
UPDATE department d
SET status = 'active'
FROM finance_organizations fo
WHERE d.organization_id = fo.organization_id
  AND d.code = 'finance'
  AND d.is_seeded = true
  AND d.status <> 'active';

WITH finance_organizations AS (
  SELECT DISTINCT om.organization_id
  FROM organization_module om
  JOIN module m ON m.id = om.module_id
  WHERE om.status = 'enabled'
    AND m.key IN ('billing-terms', 'invoicing', 'payments', 'receivables', 'payables', 'accounting')
)
UPDATE position p
SET status = 'active'
FROM finance_organizations fo
WHERE p.organization_id = fo.organization_id
  AND p.department_id IN (
    SELECT d.id
    FROM department d
    WHERE d.organization_id = fo.organization_id AND d.code = 'finance'
  )
  AND p.is_seeded = true
  AND p.status <> 'active';
