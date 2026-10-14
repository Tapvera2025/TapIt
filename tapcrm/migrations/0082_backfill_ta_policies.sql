-- Backfill TA registry actions and position policies for databases that
-- already applied 0081 before TA self-service policies were registered.
INSERT INTO registry_action (
  action, module, resource, domain, sensitive, approval_bearing, initiator_field,
  position_grantable, delegation_allowed, super_admin_only, description
)
VALUES
  ('ta:view', 'ta', NULL, 'people', false, false, NULL, true, true, false, 'View TA statements within the caller scope.'),
  ('ta:view-own', 'ta', NULL, 'people', false, false, NULL, true, true, false, 'View personal TA statements.'),
  ('ta:manage', 'ta', NULL, 'people', true, false, NULL, true, false, false, 'Manage daily TA assignments.'),
  ('ta:recalculate', 'ta', NULL, 'people', true, false, NULL, true, false, false, 'Recalculate TA statements from attendance.'),
  ('ta:send', 'ta', NULL, 'people', true, false, NULL, true, false, false, 'Send TA statements to employee dashboards.'),
  ('ta:export', 'ta', NULL, 'people', true, false, NULL, true, false, false, 'Export TA statements.')
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

INSERT INTO position_policy (organization_id, position_id, action, allowed, scope)
SELECT p.organization_id, p.id, 'ta:view-own', true, 'own'
FROM position p
WHERE p.status = 'active'
ON CONFLICT (organization_id, position_id, action) DO NOTHING;

INSERT INTO position_policy (organization_id, position_id, action, allowed, scope)
SELECT p.organization_id, p.id, actions.action, true, 'all-people'
FROM position p
CROSS JOIN (VALUES
  ('ta:view'), ('ta:manage'), ('ta:recalculate'), ('ta:send'), ('ta:export')
) AS actions(action)
WHERE p.code IN ('hr', 'hr-executive') AND p.status = 'active'
ON CONFLICT (organization_id, position_id, action) DO NOTHING;
