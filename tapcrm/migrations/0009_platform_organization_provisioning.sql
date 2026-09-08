-- =====================================================================
-- 0009 — Platform organization provisioning
--
-- The platform organization-admin flow runs through platformDb, but it still
-- uses the runtime database role. It needs INSERT on the global organization
-- table to create a company. SELECT remains required for INSERT ... RETURNING.
-- No tenant-table write or DDL privilege is granted here.
-- =====================================================================

GRANT INSERT ON organization TO tapcrm_app;
