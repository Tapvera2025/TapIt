-- Period creation is a setup operation, not an approval decision.
-- Keep close-period approval/SoD enforcement on resource-backed close routes.
INSERT INTO registry_action (
  action, module, resource, domain, sensitive, approval_bearing, initiator_field,
  position_grantable, delegation_allowed, super_admin_only, description
) VALUES (
  'accounting:manage-periods', 'accounting', 'accountingPeriod', 'business',
  true, false, NULL, true, false, false,
  'Create accounting periods for the organization.'
)
ON CONFLICT (action) DO NOTHING;

INSERT INTO position_policy (organization_id, position_id, action, allowed, scope)
SELECT organization_id, position_id, 'accounting:manage-periods', allowed, scope
FROM position_policy
WHERE action = 'accounting:close-period'
ON CONFLICT (organization_id, position_id, action) DO NOTHING;
