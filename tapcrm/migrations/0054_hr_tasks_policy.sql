-- =====================================================================
-- 0054 — HR Tasks Policy
--
-- Provision canonical department-scoped task policies for active HR
-- positions across existing organizations.
-- ON CONFLICT DO NOTHING preserves any existing customizations.
-- =====================================================================

INSERT INTO position_policy (organization_id, position_id, action, allowed, scope)
SELECT p.organization_id, p.id, permissions.action, true, permissions.scope
FROM position p
CROSS JOIN (
  VALUES
    ('tasks:view'::text, 'department'::text),
    ('tasks:assign'::text, 'department'::text),
    ('tasks:update'::text, 'department'::text),
    ('tasks:review'::text, 'department'::text),
    ('tasks:manage-dependencies'::text, 'department'::text),
    ('tasks:log-time'::text, 'department'::text)
) AS permissions(action, scope)
WHERE p.code IN ('hr', 'hr-executive')
  AND p.status = 'active'
ON CONFLICT (organization_id, position_id, action) DO NOTHING;
