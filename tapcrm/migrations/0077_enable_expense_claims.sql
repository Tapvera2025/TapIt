-- Enable the existing Payables module for expense claims in organizations
-- created before the Expenses module was introduced.
INSERT INTO organization_module (organization_id, module_id, status, enabled_at)
SELECT o.id, m.id, 'enabled', now()
FROM organization o
JOIN module m ON m.key = 'payables'
WHERE o.status = 'active'
ON CONFLICT (organization_id, module_id) DO UPDATE
SET status = 'enabled', enabled_at = COALESCE(organization_module.enabled_at, now());

-- Every active employee may submit and view their own expense claims.
INSERT INTO position_policy (organization_id, position_id, action, allowed, scope)
SELECT p.organization_id, p.id, 'payables:claim', true, 'own'
FROM position p
WHERE p.status = 'active'
ON CONFLICT (organization_id, position_id, action) DO UPDATE
SET allowed = EXCLUDED.allowed, scope = EXCLUDED.scope;

-- HR and HR Executive may review claims within the organization.
INSERT INTO position_policy (organization_id, position_id, action, allowed, scope)
SELECT p.organization_id, p.id, actions.action, true, 'all-people'
FROM position p
CROSS JOIN (VALUES ('payables:claim'), ('payables:approve-claim')) AS actions(action)
WHERE p.code IN ('hr', 'hr-executive') AND p.status = 'active'
ON CONFLICT (organization_id, position_id, action) DO UPDATE
SET allowed = EXCLUDED.allowed, scope = EXCLUDED.scope;
