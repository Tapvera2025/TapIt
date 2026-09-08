-- =====================================================================
-- 0013 — Allow the platform runtime role to delete an organization root
-- =====================================================================
-- The platform delete operation cascades through tenant-owned tables via the
-- constraints configured in 0012. The shared module catalog is unaffected.
GRANT DELETE ON organization TO tapcrm_app;

