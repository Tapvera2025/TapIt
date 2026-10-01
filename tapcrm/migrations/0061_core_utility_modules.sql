-- =====================================================================
-- 0061 — Chat, Notifications and Workspace are core, not optional bundles
-- =====================================================================
-- These three were never selectable through any platform module bundle
-- (PLATFORM_MODULE_GROUPS), so a newly provisioned organization could never
-- enable them without a manual DB write — chat:view/chat:send are meant to
-- be granted to every employee position by default (CH-1), the notification
-- engine underpins the bell every workspace already renders unconditionally,
-- and My Notepad (workspace) is likewise shown to every employee regardless
-- of module selection. Marking them core makes organization provisioning
-- (and later module-enable) auto-include them like identity/organization
-- already are, via `all.filter((m) => m.isCore || selectedIds.has(m.id))`.
UPDATE module SET is_core = true, updated_at = now()
WHERE key IN ('chat', 'notifications', 'workspace') AND is_core = false;

-- Backfill: organizations provisioned before this migration never got an
-- entitlement row for these modules at all.
INSERT INTO organization_module (organization_id, module_id, status, enabled_at)
SELECT o.id, m.id, 'enabled', now()
FROM organization o
CROSS JOIN module m
WHERE m.key IN ('chat', 'notifications', 'workspace')
  AND NOT EXISTS (
    SELECT 1 FROM organization_module om
    WHERE om.organization_id = o.id AND om.module_id = m.id
  );

-- Backfill: organizations that got an entitlement row pre-fix but with it
-- disabled (core modules can never be disabled going forward).
UPDATE organization_module om
SET status = 'enabled', enabled_at = now(), disabled_at = NULL
FROM module m
WHERE om.module_id = m.id
  AND m.key IN ('chat', 'notifications', 'workspace')
  AND om.status <> 'enabled';
