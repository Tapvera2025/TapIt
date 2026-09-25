-- =====================================================================
-- 0049 — reconcile invalid position-policy grants
--
-- Position policies may contain only actions permitted by the canonical
-- registry. Remove only rows that the registry explicitly identifies as
-- non-position-grantable or Super Admin-only; valid tenant policy rows and
-- their custom scopes/fields/constraints are preserved unchanged.
-- =====================================================================

DELETE FROM position_policy pp
USING registry_action action_definition
WHERE action_definition.action = pp.action
  AND (
    action_definition.position_grantable = false
    OR action_definition.super_admin_only = true
  );
