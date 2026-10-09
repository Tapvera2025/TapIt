-- HR can review and process the existing Advance Requests page alongside
-- Super Admin. Keep the same centralized action model and resource policy.
UPDATE registry_action
SET position_grantable = true, super_admin_only = false
WHERE action IN ('advance:approve', 'advance:manage', 'advance:export');

INSERT INTO position_policy (organization_id, position_id, action, allowed, scope)
SELECT p.organization_id, p.id, actions.action, true, 'all-people'
FROM position p
CROSS JOIN (VALUES ('advance:view'), ('advance:approve'), ('advance:manage'), ('advance:export')) AS actions(action)
WHERE p.code IN ('hr', 'hr-executive') AND p.status = 'active'
ON CONFLICT (organization_id, position_id, action) DO UPDATE
SET allowed = EXCLUDED.allowed, scope = EXCLUDED.scope;
