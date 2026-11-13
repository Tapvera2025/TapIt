-- Register SEO Intelligence for explicit organization enablement.
INSERT INTO module (key, name, description) VALUES
('seo-intelligence', 'SEO Intelligence', 'Website audits, findings and SEO team workflows')
ON CONFLICT (key) DO NOTHING;

INSERT INTO module_dependency (module_id, depends_on_module_id)
SELECT seo.id, dependency.id FROM module seo CROSS JOIN module dependency
WHERE seo.key = 'seo-intelligence' AND dependency.key IN ('clients', 'projects')
ON CONFLICT DO NOTHING;

INSERT INTO registry_action
(action, module, resource, domain, sensitive, approval_bearing, initiator_field, position_grantable, delegation_allowed, super_admin_only)
VALUES
('seo:create-site', 'seo-intelligence', NULL, 'business', false, false, NULL, true, true, false),
('seo:list-findings', 'seo-intelligence', 'seo_site', 'business', false, false, NULL, true, true, false),
('seo:list-scans', 'seo-intelligence', 'seo_site', 'business', false, false, NULL, true, true, false),
('seo:list-sites', 'seo-intelligence', NULL, 'business', false, false, NULL, true, true, false),
('seo:read-finding', 'seo-intelligence', NULL, 'business', false, false, NULL, true, true, false),
('seo:read-scan', 'seo-intelligence', NULL, 'business', false, false, NULL, true, true, false),
('seo:read-search-performance', 'seo-intelligence', 'seo_site', 'business', false, false, NULL, true, true, false),
('seo:read-site', 'seo-intelligence', 'seo_site', 'business', false, false, NULL, true, true, false),
('seo:sync-search-performance', 'seo-intelligence', 'seo_site', 'business', false, false, NULL, true, true, false),
('seo:trigger-scan', 'seo-intelligence', 'seo_site', 'business', false, false, NULL, true, true, false),
('seo:list-alerts', 'seo-intelligence', 'seo_site', 'business', false, false, NULL, true, true, false),
('seo:list-fixes', 'seo-intelligence', 'seo_site', 'business', false, false, NULL, true, true, false),
('seo:list-keywords', 'seo-intelligence', 'seo_site', 'business', false, false, NULL, true, true, false),
('seo:list-rules', 'seo-intelligence', NULL, 'business', false, false, NULL, true, true, false),
('seo:read-ai-visibility', 'seo-intelligence', 'seo_site', 'business', false, false, NULL, true, true, false),
('seo:read-backlinks', 'seo-intelligence', 'seo_site', 'business', false, false, NULL, true, true, false),
('seo:read-cwv', 'seo-intelligence', 'seo_site', 'business', false, false, NULL, true, true, false),
('seo:read-rank-tracking', 'seo-intelligence', 'seo_site', 'business', false, false, NULL, true, true, false),
('seo:update-finding', 'seo-intelligence', NULL, 'business', false, false, NULL, true, true, false),
('seo:update-fix', 'seo-intelligence', NULL, 'business', false, false, NULL, true, true, false),
('seo:update-rule', 'seo-intelligence', NULL, 'business', false, false, NULL, true, true, false),
('seo:update-site', 'seo-intelligence', 'seo_site', 'business', false, false, NULL, true, true, false)
ON CONFLICT (action) DO NOTHING;
