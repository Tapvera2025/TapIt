-- =====================================================================
-- 0056 - user_status: projector writes (correction to 0055)
--
-- 0055 revoked INSERT, UPDATE and DELETE from the app role, reading LS-9
-- as "no writes at all." That was too strict: the projector runs inside
-- ordinary tenant transactions (called from `appendEvent`, which is the
-- punch route or the ledger under RLS). LS-9's intent is "no manual
-- correction ROUTE on the board" — not "no writes." Same shape as
-- `attendance_record`, whose calculator UPDATEs land through the app
-- role too.
--
-- Grant back INSERT and UPDATE; DELETE stays revoked so nobody can
-- silently drop a person from the board.
-- =====================================================================

GRANT INSERT, UPDATE ON user_status TO tapcrm_app;
