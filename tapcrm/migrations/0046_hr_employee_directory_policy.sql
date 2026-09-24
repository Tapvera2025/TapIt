-- =====================================================================
-- 0046 — HR employee-directory and designation read policies
--
-- `users:manage` is position-grantable for the seeded HR position, but
-- remains non-delegable. Designation metadata has a separate read action so
-- employee creation does not require designation-management authority.
-- =====================================================================

UPDATE registry_action
SET position_grantable = true,
    delegation_allowed = false,
    super_admin_only = false
WHERE action = 'users:manage';

INSERT INTO registry_action (
  action, module, resource, domain, sensitive, approval_bearing, initiator_field,
  position_grantable, delegation_allowed, super_admin_only, description
)
VALUES (
  'org:view-designations', 'organization', 'designation', 'business', false, false, NULL,
  true, true, false, ''
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

-- Apply the same defaults emitted by the current organization matrix to
-- existing seeded positions. ON CONFLICT preserves tenant customizations.
INSERT INTO position_policy (organization_id, position_id, action, allowed, scope)
SELECT p.organization_id, p.id, permissions.action, true, permissions.scope
FROM position p
CROSS JOIN (
  VALUES
    ('users:manage'::text, 'all-people'::text)
) AS permissions(action, scope)
WHERE p.code = 'hr'
  AND p.status = 'active'
ON CONFLICT (organization_id, position_id, action) DO NOTHING;

INSERT INTO position_policy (organization_id, position_id, action, allowed, scope)
SELECT p.organization_id, p.id, 'org:view-designations', true, 'department'
FROM position p
WHERE p.code IN ('hr', 'hr-executive', 'sales-head', 'project-manager', 'dev-dept-head')
  AND p.status = 'active'
ON CONFLICT (organization_id, position_id, action) DO NOTHING;
