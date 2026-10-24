-- =====================================================================
-- 0091 - Weekday schedules
--
-- A weekday schedule answers only whether an employee's assigned shift is
-- applicable on a weekday. Shift timing and attendance thresholds remain in
-- the existing shift/shift_version tables.
-- =====================================================================

CREATE TABLE weekday_schedule (
  id                 uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id    uuid NOT NULL REFERENCES organization(id),
  name               text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  working_weekdays   smallint[] NOT NULL,
  status             text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_by         uuid NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, created_by) REFERENCES app_user (organization_id, id),
  CHECK (cardinality(working_weekdays) BETWEEN 1 AND 7),
  CHECK (working_weekdays <@ ARRAY[1, 2, 3, 4, 5, 6, 7]::smallint[])
);

CREATE TABLE weekday_schedule_assignment (
  id                  uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id     uuid NOT NULL REFERENCES organization(id),
  user_id             uuid NOT NULL,
  schedule_id         uuid NOT NULL,
  effective_from      date NOT NULL,
  effective_to        date,
  created_by          uuid NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, user_id) REFERENCES app_user (organization_id, id),
  FOREIGN KEY (organization_id, schedule_id) REFERENCES weekday_schedule (organization_id, id),
  FOREIGN KEY (organization_id, created_by) REFERENCES app_user (organization_id, id),
  CHECK (effective_to IS NULL OR effective_to > effective_from),
  EXCLUDE USING gist (
    organization_id WITH =,
    user_id WITH =,
    daterange(effective_from, effective_to, '[)') WITH &&
  )
);

CREATE INDEX weekday_schedule_assignment_user_idx
  ON weekday_schedule_assignment (organization_id, user_id, effective_from);

SELECT apply_tenant_rls('weekday_schedule');
SELECT apply_tenant_rls('weekday_schedule_assignment');

GRANT SELECT, INSERT, UPDATE ON weekday_schedule TO tapcrm_app;
GRANT SELECT, INSERT, UPDATE ON weekday_schedule_assignment TO tapcrm_app;
REVOKE DELETE ON weekday_schedule, weekday_schedule_assignment FROM tapcrm_app;
