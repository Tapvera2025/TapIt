-- =====================================================================
-- 0065 - HR-only People approvals, web punching, direct placement change
--
-- Owner decisions of 29 September 2026:
--
--   * Approvals and People configuration belong to HR and Super Admin
--     only. The starter matrix used to expand every People module into
--     all of its actions for every position, so an `own` cell gave a
--     Developer leave:manage-types, shifts:manage, breaks:manage-policy,
--     leave:decide, attendance:correct ... Configuration has no owner, so
--     those grants were tenant-wide in practice. The matrix now emits
--     them only from all-people cells (policy-matrix.ts HR_ONLY_ACTIONS);
--     this migration removes the rows it would no longer create.
--   * Employees punch in and out, and start and end breaks, from the web
--     (status:punch, G1).
--   * Super Admin may change an employee's position, department and
--     manager directly (users:change-placement, Super Admin only).
-- =====================================================================

-- 1. Registry projections for the two new actions (RG-I3).
INSERT INTO registry_action (
  action, module, resource, domain, sensitive, approval_bearing, initiator_field,
  position_grantable, delegation_allowed, super_admin_only, description
)
VALUES
  ('status:punch', 'live-status', NULL, 'people', false, false, NULL, true, true, false, ''),
  ('users:change-placement', 'employee-directory', 'user', 'people', true, false, NULL, true, false, true, '')
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

-- 2. Approvals and configuration: HR (all-people) only.
DELETE FROM position_policy
WHERE action IN (
    'attendance:correct', 'attendance:raise-correction', 'attendance:export',
    'breaks:manage-policy', 'breaks:review-breach',
    'shifts:manage', 'shifts:approve',
    'leave:acknowledge', 'leave:decide', 'leave:manage-types', 'leave:manage-wfh-standing',
    'holidays:manage', 'biometric:manage',
    'payroll:manage', 'payroll:manage-config'
  )
  AND scope <> 'all-people';

-- 3. Self-service acts on the holder alone outside HR.
UPDATE position_policy
SET scope = 'own'
WHERE action IN ('attendance:request-correction', 'breaks:explain', 'leave:request', 'leave:request-wfh')
  AND scope IN ('participant', 'pool', 'team', 'department');

-- 4. Every position that can see its own attendance can punch.
INSERT INTO position_policy (organization_id, position_id, action, allowed, scope)
SELECT pp.organization_id,
       pp.position_id,
       'status:punch',
       true,
       CASE WHEN pp.scope = 'all-people' THEN 'all-people' ELSE 'own' END
FROM position_policy pp
WHERE pp.action = 'attendance:view'
  AND pp.allowed
ON CONFLICT (organization_id, position_id, action) DO NOTHING;
