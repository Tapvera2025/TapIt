-- =====================================================================
-- 0047 — HR position-policy preview access
--
-- HR may read position policies for the employee Access Preview. This is
-- deliberately separate from org:manage-positions and access:view.
-- =====================================================================

INSERT INTO position_policy (organization_id, position_id, action, allowed, scope)
SELECT p.organization_id, p.id, 'org:view-policies', true, 'department'
FROM position p
WHERE p.code = 'hr'
  AND p.status = 'active'
ON CONFLICT (organization_id, position_id, action) DO NOTHING;
