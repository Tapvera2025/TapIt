-- Make the position-change request workflow available to existing seeded
-- organizations as well as organizations created after the policy-matrix
-- default was added. These grants do not include access:view.
INSERT INTO position_policy (organization_id, position_id, action, allowed, scope)
SELECT p.organization_id, p.id, permissions.action, true, permissions.scope
FROM position p
CROSS JOIN (
  VALUES
    ('access:request-role-change'::text, 'department'::text),
    ('org:view-structure'::text, 'department'::text),
    ('users:view'::text, 'team'::text)
) AS permissions(action, scope)
WHERE p.code = 'sub-team-manager'
  AND p.status = 'active'
ON CONFLICT (organization_id, position_id, action) DO NOTHING;
