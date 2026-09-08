-- =====================================================================
-- 0014 — Allow the platform runtime role to activate or suspend companies
-- =====================================================================
-- Status changes update only the organization root. Company data remains
-- untouched when a company is suspended.
GRANT UPDATE ON organization TO tapcrm_app;
