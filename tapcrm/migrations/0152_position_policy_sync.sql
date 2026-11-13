-- =====================================================================
-- 0152 — Position policies: one truth for the editor, Access Explorer
--        and the authorization engine
-- =====================================================================
-- Payroll management is an HR power: 0080 granted it to HR and HR Executive
-- and the starter matrix lists it as HR-only, but the registry still called it
-- Super Admin-only. The position editor therefore showed it locked, the Access
-- Explorer showed HR holding it, and saving HR's policies silently deleted it.
-- AUTHORIZATION.md §6.4 now marks both actions position-grantable.
UPDATE registry_action
SET super_admin_only = false
WHERE action IN ('payroll:manage', 'payroll:manage-config');

-- The rest of this release step needs the registry and the starter matrix,
-- which live in code, so tools/migrate.ts runs it right after this file in the
-- same transaction:
--
--   1. registry_action is re-projected from seeds/registry.seed.json (RG-I3).
--      Production only runs migrations, so the projection had fallen behind
--      the code (four SEO actions and social:connect-own-accounts missing,
--      stale resources on two SEO actions).
--
--   2. Stored policies whose scope their action's domain cannot hold
--      ('all-people' on a business-domain action, PD-1) are narrowed to
--      'department'. The engine refused them at runtime and the editor
--      refused to save any position that carried one (HR, HR Executive).
--
--   3. Every company's seeded positions get the starter-matrix defaults they
--      are missing, insert-only. Existing rows — including powers a company
--      switched off — are never changed. Saving a position's policies had been
--      failing (more grantable powers than the save accepted), so many
--      positions never received powers added to their modules later.
