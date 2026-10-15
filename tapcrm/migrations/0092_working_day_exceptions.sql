-- Working-day exceptions turn a scheduled week-off into a normal working day
-- for the whole organization or selected departments.

CREATE TABLE working_day_exception (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL REFERENCES organization(id),
  exception_date  date NOT NULL,
  reason          text NOT NULL CHECK (length(trim(reason)) > 0),
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_by      uuid NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, created_by) REFERENCES app_user (organization_id, id)
);

CREATE TABLE working_day_exception_scope (
  organization_id uuid NOT NULL REFERENCES organization(id),
  exception_id    uuid NOT NULL,
  exception_date  date NOT NULL,
  department_id   uuid NOT NULL,
  FOREIGN KEY (organization_id, exception_id)
    REFERENCES working_day_exception (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, department_id)
    REFERENCES department (organization_id, id),
  UNIQUE (organization_id, exception_id, department_id),
  UNIQUE (organization_id, exception_date, department_id)
);

CREATE INDEX working_day_exception_date_idx
  ON working_day_exception (organization_id, exception_date, status);
CREATE INDEX working_day_exception_scope_date_idx
  ON working_day_exception_scope (organization_id, exception_date, department_id);

SELECT apply_tenant_rls('working_day_exception');
SELECT apply_tenant_rls('working_day_exception_scope');

GRANT SELECT, INSERT, UPDATE ON working_day_exception TO tapcrm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON working_day_exception_scope TO tapcrm_app;
REVOKE DELETE ON working_day_exception FROM tapcrm_app;
