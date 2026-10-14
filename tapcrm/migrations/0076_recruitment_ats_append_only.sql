-- =====================================================================
-- 0073 — ATS scan reports are append-only for the application role
--
-- A scan report is the record of how an application was screened: the
-- criteria, resume fingerprint, engine version and evidence behind a score.
-- 0072 grants only SELECT and INSERT, but the default privileges from 0001
-- already give every new table full DML, so the intent must be enforced
-- explicitly — the same treatment audit_entry gets in 0003.
-- =====================================================================
REVOKE UPDATE, DELETE ON recruitment_ats_scan FROM tapcrm_app;
