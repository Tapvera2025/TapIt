-- =====================================================================
-- 0023 - Approved Work From Home days
-- =====================================================================

CREATE TABLE work_from_home_day (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id  uuid NOT NULL REFERENCES organization(id),
  user_id          uuid NOT NULL,
  work_date        date NOT NULL,
  reason           text NOT NULL,
  approved_by      uuid NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, user_id, work_date),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, user_id) REFERENCES app_user (organization_id, id),
  FOREIGN KEY (organization_id, approved_by) REFERENCES app_user (organization_id, id)
);

SELECT apply_tenant_rls('work_from_home_day');
GRANT SELECT, INSERT, UPDATE, DELETE ON work_from_home_day TO tapcrm_app;
