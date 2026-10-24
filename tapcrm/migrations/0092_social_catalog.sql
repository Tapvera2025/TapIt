-- Additive catalog/authorization projection. Rollback: disable the social entitlement;
-- keep stored data and credentials until an administrator has exported/revoked them.
INSERT INTO module (key, name, description) VALUES
('social', 'Manage Social Media', 'Client social accounts, approval, publishing and analytics')
ON CONFLICT (key) DO NOTHING;
INSERT INTO module_dependency (module_id, depends_on_module_id)
SELECT social.id, clients.id FROM module social CROSS JOIN module clients
WHERE social.key = 'social' AND clients.key = 'clients'
ON CONFLICT DO NOTHING;
INSERT INTO organization_module (organization_id, module_id, status, enabled_at)
SELECT om.organization_id, social.id, om.status, CASE WHEN om.status = 'enabled' THEN now() ELSE NULL END
FROM organization_module om JOIN module clients ON clients.id = om.module_id AND clients.key = 'clients'
CROSS JOIN module social WHERE social.key = 'social'
ON CONFLICT DO NOTHING;
INSERT INTO registry_action
(action, module, resource, domain, sensitive, approval_bearing, initiator_field, position_grantable, delegation_allowed, super_admin_only)
VALUES
('social:view','social','socialWorkspace','business',false,false,NULL,true,true,false),
('social:manage','social','socialWorkspace','business',true,false,NULL,true,false,false),
('social:publish','social','socialWorkspace','business',true,false,NULL,true,false,false),
('social:connect','social','socialWorkspace','business',true,false,NULL,true,false,false),
('social:settings','social','socialWorkspace','business',true,false,NULL,true,false,false),
('social:approve','social','socialPost','business',true,true,'createdBy',true,false,false)
ON CONFLICT (action) DO NOTHING;
