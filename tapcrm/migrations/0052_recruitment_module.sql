-- =====================================================================
-- 0052 — Recruitment module catalog and entitlement
-- =====================================================================

-- 1. Module catalog entry
INSERT INTO module (key, name, description, is_core)
VALUES ('recruitment', 'Recruitment', 'Job requisitions, candidate pipeline, interviews, offers, and joining workflows', false)
ON CONFLICT (key) DO NOTHING;

-- 2. Foundation dependency on identity
INSERT INTO module_dependency (module_id, depends_on_module_id)
SELECT m.id, d.id FROM module m JOIN module d ON d.key = 'identity'
WHERE m.key = 'recruitment'
ON CONFLICT DO NOTHING;

-- 3. Domain dependency on employee-directory
INSERT INTO module_dependency (module_id, depends_on_module_id)
SELECT m.id, d.id FROM module m JOIN module d ON d.key = 'employee-directory'
WHERE m.key = 'recruitment'
ON CONFLICT DO NOTHING;

-- 4. Enable recruitment entitlement for organizations that have employee-directory enabled
INSERT INTO organization_module (organization_id, module_id, status, enabled_at)
SELECT om.organization_id, m.id, 'enabled', now()
FROM organization_module om
JOIN module ed ON ed.id = om.module_id AND ed.key = 'employee-directory'
CROSS JOIN module m
WHERE m.key = 'recruitment' AND om.status = 'enabled'
ON CONFLICT (organization_id, module_id) DO NOTHING;

-- 5. Registry action projections for recruitment domain
INSERT INTO registry_action (
  action, module, resource, domain, sensitive, approval_bearing, initiator_field,
  position_grantable, delegation_allowed, super_admin_only, description
)
VALUES
  ('recruitment:view-metrics', 'recruitment', NULL, 'business', false, false, NULL, true, true, false, ''),
  ('recruitment:view-requisitions', 'recruitment', 'jobRequisition', 'business', false, false, NULL, true, true, false, ''),
  ('recruitment:manage-requisitions', 'recruitment', 'jobRequisition', 'business', false, false, NULL, true, true, false, ''),
  ('recruitment:view-candidates', 'recruitment', 'candidate', 'business', false, false, NULL, true, true, false, ''),
  ('recruitment:manage-candidates', 'recruitment', 'candidate', 'business', false, false, NULL, true, true, false, ''),
  ('recruitment:view-interviews', 'recruitment', 'interview', 'business', false, false, NULL, true, true, false, ''),
  ('recruitment:manage-interviews', 'recruitment', 'interview', 'business', false, false, NULL, true, true, false, ''),
  ('recruitment:view-offers', 'recruitment', 'jobOffer', 'business', false, false, NULL, true, true, false, ''),
  ('recruitment:manage-offers', 'recruitment', 'jobOffer', 'business', false, false, NULL, true, true, false, ''),
  ('recruitment:view-joining', 'recruitment', 'candidateJoining', 'business', false, false, NULL, true, true, false, ''),
  ('recruitment:manage-joining', 'recruitment', 'candidateJoining', 'business', false, false, NULL, true, true, false, ''),
  ('recruitment:manage-links', 'recruitment', 'recruitmentApplicationLink', 'business', false, false, NULL, true, true, false, ''),
  ('recruitment:manage-submissions', 'recruitment', 'candidateResumeSubmission', 'business', false, false, NULL, true, true, false, '')
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

-- 6. Apply default recruitment position policies to seeded HR positions
INSERT INTO position_policy (organization_id, position_id, action, allowed, scope)
SELECT p.organization_id, p.id, actions.action, true, 'department'
FROM position p
CROSS JOIN (
  VALUES
    ('recruitment:view-metrics'::text),
    ('recruitment:view-requisitions'::text),
    ('recruitment:manage-requisitions'::text),
    ('recruitment:view-candidates'::text),
    ('recruitment:manage-candidates'::text),
    ('recruitment:view-interviews'::text),
    ('recruitment:manage-interviews'::text),
    ('recruitment:view-offers'::text),
    ('recruitment:manage-offers'::text),
    ('recruitment:view-joining'::text),
    ('recruitment:manage-joining'::text),
    ('recruitment:manage-links'::text),
    ('recruitment:manage-submissions'::text)
) AS actions(action)
WHERE p.code IN ('hr', 'hr-executive')
  AND p.status = 'active'
ON CONFLICT (organization_id, position_id, action) DO NOTHING;

-- 7. Apply participant-scoped interview actions to employee positions
INSERT INTO position_policy (organization_id, position_id, action, allowed, scope)
SELECT p.organization_id, p.id, actions.action, true, 'participant'
FROM position p
CROSS JOIN (
  VALUES
    ('recruitment:view-interviews'::text),
    ('recruitment:manage-interviews'::text)
) AS actions(action)
WHERE p.code IN ('developer-intern', 'content-intern', 'marketing-executive-intern', 'hr-intern')
  AND p.status = 'active'
ON CONFLICT (organization_id, position_id, action) DO NOTHING;
