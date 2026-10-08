-- Existing organizations may have employee positions that were created after
-- 0072, or positions other than base-employee. Give every active position the
-- self-service penalty view while leaving management actions unchanged.
INSERT INTO position_policy (organization_id, position_id, action, allowed, scope)
SELECT p.organization_id, p.id, 'penalty:view-own', true, 'own'
FROM position p
WHERE p.status = 'active'
ON CONFLICT (organization_id, position_id, action) DO NOTHING;
