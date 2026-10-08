INSERT INTO registry_action (
  action, module, resource, domain, sensitive, approval_bearing, initiator_field,
  position_grantable, delegation_allowed, super_admin_only, description
)
VALUES (
  'penalty:export', 'penalties', 'employeePenalty', 'people', true, false, NULL,
  true, false, false, 'Export employee penalties within the caller scope.'
)
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
SELECT p.organization_id, p.id, 'penalty:export', true, 'all-people'
FROM position p
WHERE p.code IN ('hr', 'hr-executive') AND p.status = 'active'
ON CONFLICT (organization_id, position_id, action) DO NOTHING;
