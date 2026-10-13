-- Restore the canonical payroll management grant for existing HR positions.
-- New organizations receive this through the policy matrix; this migration
-- repairs tenants provisioned before the HR-only payroll policy was finalized.
INSERT INTO position_policy (organization_id, position_id, action, allowed, scope)
SELECT p.organization_id, p.id, permissions.action, true, 'all-people'
FROM position p
CROSS JOIN (VALUES ('payroll:manage'::text), ('payroll:manage-config'::text)) AS permissions(action)
WHERE p.code IN ('hr', 'hr-executive')
  AND p.status = 'active'
ON CONFLICT (organization_id, position_id, action) DO UPDATE
SET allowed = EXCLUDED.allowed,
    scope = EXCLUDED.scope;
