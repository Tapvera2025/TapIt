-- =====================================================================
-- 0069 - Per-user dashboard preferences
--
-- The workspace overview is now user-editable: they add/remove widgets
-- from a catalog and arrange them on a grid. Only their own choices are
-- stored — the widget catalog and its permission gates live in code.
--
--   * layout: an array of { i, x, y, w, h } items describing each widget's
--     position and size on the grid. Widgets absent from layout render at
--     their catalog default.
--   * hidden: widget ids the user has removed from view.
--
-- Widget ids are validated in the service against the server-side catalog,
-- so an outdated client cannot poison the row with unknown ids.
-- =====================================================================

CREATE TABLE dashboard_preferences (
  organization_id uuid        NOT NULL,
  user_id         uuid        NOT NULL,
  layout          jsonb       NOT NULL DEFAULT '[]'::jsonb,
  hidden          text[]      NOT NULL DEFAULT ARRAY[]::text[],
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id),
  FOREIGN KEY (organization_id, user_id)
    REFERENCES app_user (organization_id, id) ON DELETE CASCADE
);

SELECT apply_tenant_rls('dashboard_preferences');
