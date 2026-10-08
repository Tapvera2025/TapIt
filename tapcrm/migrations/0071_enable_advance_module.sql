-- Backfill Advance entitlement and self-service policies for organizations
-- that already ran 0070 before Advance was made a standard People module.

UPDATE module
SET is_core = true
WHERE key = 'advance';

INSERT INTO registry_action (
  action, module, resource, domain, sensitive, approval_bearing, initiator_field,
  position_grantable, delegation_allowed, super_admin_only, description
)
VALUES
  ('advance:view-own', 'advance', 'employeeAdvance', 'people', false, false, NULL, true, true, false, 'See personal advance requests and deductions.'),
  ('advance:request', 'advance', 'employeeAdvance', 'people', false, false, NULL, true, true, false, 'Request an employee advance.'),
  ('advance:view', 'advance', 'employeeAdvance', 'people', false, false, NULL, true, true, false, 'See organization advances.'),
  ('advance:approve', 'advance', 'employeeAdvance', 'people', true, true, 'requestedBy', false, false, true, 'Approve or reject an advance request.'),
  ('advance:manage', 'advance', 'employeeAdvance', 'people', true, false, NULL, false, false, true, 'Manage manual advances and deductions.'),
  ('advance:export', 'advance', 'employeeAdvance', 'people', true, false, NULL, false, false, true, 'Export advance deductions.')
ON CONFLICT (action) DO UPDATE SET
  module = EXCLUDED.module,
  resource = EXCLUDED.resource,
  domain = EXCLUDED.domain,
  sensitive = EXCLUDED.sensitive,
  approval_bearing = EXCLUDED.approval_bearing,
  initiator_field = EXCLUDED.initiator_field,
  position_grantable = EXCLUDED.position_grantable,
  delegation_allowed = EXCLUDED.delegation_allowed,
  super_admin_only = EXCLUDED.super_admin_only,
  description = EXCLUDED.description;

INSERT INTO organization_module (organization_id, module_id, status, enabled_at)
SELECT o.id, m.id, 'enabled', now()
FROM organization o
JOIN module m ON m.key = 'advance'
ON CONFLICT (organization_id, module_id) DO UPDATE
SET status = 'enabled', enabled_at = COALESCE(organization_module.enabled_at, now());

INSERT INTO position_policy (organization_id, position_id, action, allowed, scope)
SELECT p.organization_id, p.id, actions.action, true, 'own'
FROM position p
CROSS JOIN (VALUES ('advance:view-own'), ('advance:request'), ('advance:view')) AS actions(action)
WHERE p.status = 'active'
ON CONFLICT (organization_id, position_id, action) DO NOTHING;
