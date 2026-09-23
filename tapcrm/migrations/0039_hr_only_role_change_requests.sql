-- Role-change requests are an HR workflow. Remove the earlier default from
-- seeded sub-team managers; Super Admin remains the only decision-maker.
DELETE FROM position_policy pp
USING position p
WHERE pp.organization_id = p.organization_id
  AND pp.position_id = p.id
  AND p.code = 'sub-team-manager'
  AND pp.action = 'access:request-role-change';

INSERT INTO position_policy (organization_id, position_id, action, allowed, scope)
SELECT p.organization_id, p.id, 'access:request-role-change', true, 'department'
FROM position p
WHERE p.code = 'hr'
  AND p.status = 'active'
ON CONFLICT (organization_id, position_id, action) DO NOTHING;
