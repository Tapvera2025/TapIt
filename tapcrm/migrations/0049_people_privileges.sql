-- =====================================================================
-- 0049 - Privileges for the shift and holiday tables
--
-- Migration 0001 sets default privileges: every table a migration creates
-- gives the app role SELECT, INSERT, UPDATE and DELETE. The GRANT lines in
-- 0047 and 0048 were meant to narrow that, but a GRANT only adds, so the
-- rules they wrote down were not enforced: the app role could delete a
-- template (SH-5), rewrite a version (SH-2) or delete a holiday (HO-3).
-- These REVOKEs make the database say what those migrations meant.
-- =====================================================================

REVOKE DELETE ON shift FROM tapcrm_app;                          -- SH-5: deactivated, never deleted
REVOKE UPDATE, DELETE ON shift_version FROM tapcrm_app;          -- SH-2: a change is a new version
REVOKE DELETE ON shift_rotation FROM tapcrm_app;
REVOKE UPDATE, DELETE ON shift_rotation_day FROM tapcrm_app;
REVOKE DELETE ON shift_assignment FROM tapcrm_app;               -- ended by effective_to, never removed
REVOKE DELETE ON shift_request FROM tapcrm_app;
REVOKE UPDATE ON shift_override FROM tapcrm_app;                 -- replaced, never edited
REVOKE DELETE ON department_shift_default FROM tapcrm_app;
REVOKE UPDATE, DELETE ON shift_setting FROM tapcrm_app;          -- D35: a change is a new dated row

REVOKE DELETE ON holiday FROM tapcrm_app;                        -- withdrawn, never deleted (HO-3)
REVOKE UPDATE ON holiday_scope FROM tapcrm_app;                  -- replaced, never edited
