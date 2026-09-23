-- The seeded positions use concrete codes, while `sub-team-manager` is the
-- policy-matrix column. Remove grants created by the earlier manager default.
DELETE FROM position_policy pp
USING position p
WHERE pp.organization_id = p.organization_id
  AND pp.position_id = p.id
  AND p.code IN (
    'developer-team-manager',
    'digital-marketing-manager',
    'content-team-manager'
  )
  AND pp.action = 'access:request-role-change';
