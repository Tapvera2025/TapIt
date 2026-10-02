-- =====================================================================
-- 0061 — Leave and WFH overlays (attendance design §11)
-- =====================================================================

CREATE TABLE leave_type (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id  uuid NOT NULL REFERENCES organization(id),
  code             text NOT NULL,
  name             text NOT NULL,
  kind             text NOT NULL CHECK (kind IN ('absence', 'attendance-mode')),
  accrual_days     integer NOT NULL DEFAULT 0 CHECK (accrual_days >= 0),
  enforcement      boolean NOT NULL DEFAULT false,
  paid_leave       boolean NOT NULL DEFAULT true,
  is_active        boolean NOT NULL DEFAULT true,
  created_by       uuid NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, code),
  FOREIGN KEY (organization_id, created_by) REFERENCES app_user (organization_id, id)
);

CREATE TABLE leave_request (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id  uuid NOT NULL REFERENCES organization(id),
  user_id          uuid NOT NULL,
  leave_type_id    uuid NOT NULL,
  kind             text NOT NULL CHECK (kind IN ('absence', 'attendance-mode')),
  from_date        date NOT NULL,
  to_date          date NOT NULL,
  from_half        text NOT NULL DEFAULT 'full' CHECK (from_half IN ('full', 'first', 'second')),
  to_half          text NOT NULL DEFAULT 'full' CHECK (to_half IN ('full', 'first', 'second')),
  days_consumed    numeric(5,1) NOT NULL DEFAULT 0 CHECK (days_consumed >= 0),
  reason           text NOT NULL,
  status           text NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'acknowledged', 'approved', 'rejected', 'cancelled')),
  requested_by     uuid NOT NULL,
  acknowledged_by  uuid,
  acknowledged_at  timestamptz,
  decided_by       uuid,
  decided_at       timestamptz,
  decision_note    text,
  revoked_by       uuid,
  revoked_at       timestamptz,
  recurrence_type  text CHECK (recurrence_type IN ('daily')),
  recurrence_end   date,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, user_id, id),
  CHECK (to_date >= from_date),
  CHECK (EXTRACT(YEAR FROM from_date) = EXTRACT(YEAR FROM to_date)),
  CHECK (recurrence_type IS NULL OR kind = 'attendance-mode'),
  CHECK ((recurrence_type IS NULL) = (recurrence_end IS NULL)),
  CHECK (recurrence_end IS NULL OR recurrence_end >= to_date),
  CHECK (decided_by IS NULL OR decided_by <> requested_by),
  CHECK ((acknowledged_by IS NULL) = (acknowledged_at IS NULL)),
  CHECK ((decided_by IS NULL) = (decided_at IS NULL)),
  CHECK ((revoked_by IS NULL) = (revoked_at IS NULL)),
  FOREIGN KEY (organization_id, user_id) REFERENCES app_user (organization_id, id),
  FOREIGN KEY (organization_id, requested_by)   REFERENCES app_user (organization_id, id),
  FOREIGN KEY (organization_id, acknowledged_by) REFERENCES app_user (organization_id, id),
  FOREIGN KEY (organization_id, decided_by)      REFERENCES app_user (organization_id, id),
  FOREIGN KEY (organization_id, revoked_by)      REFERENCES app_user (organization_id, id),
  FOREIGN KEY (organization_id, leave_type_id)   REFERENCES leave_type (organization_id, id)
);
CREATE INDEX ix_leave_request_user   ON leave_request (organization_id, user_id, from_date);
CREATE INDEX ix_leave_request_status ON leave_request (organization_id, status)
  WHERE status IN ('pending', 'acknowledged');

CREATE TABLE leave_attachment (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id  uuid NOT NULL REFERENCES organization(id),
  user_id          uuid NOT NULL,
  leave_request_id uuid NOT NULL,
  filename         text NOT NULL,
  storage_key      text NOT NULL,
  content_type     text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, user_id) REFERENCES app_user (organization_id, id),
  FOREIGN KEY (organization_id, user_id, leave_request_id)
    REFERENCES leave_request (organization_id, user_id, id)
);

CREATE TABLE leave_balance_entry (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id  uuid NOT NULL REFERENCES organization(id),
  user_id          uuid NOT NULL,
  leave_type_id    uuid NOT NULL,
  kind             text NOT NULL CHECK (kind IN ('opening', 'accrual', 'consumption', 'reversal')),
  units            numeric(5,1) NOT NULL CHECK (units >= 0),
  leave_request_id uuid,
  period_year      smallint NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  CHECK (kind NOT IN ('consumption', 'reversal') OR leave_request_id IS NOT NULL),
  FOREIGN KEY (organization_id, user_id) REFERENCES app_user (organization_id, id),
  FOREIGN KEY (organization_id, leave_type_id) REFERENCES leave_type (organization_id, id),
  FOREIGN KEY (organization_id, user_id, leave_request_id)
    REFERENCES leave_request (organization_id, user_id, id)
);
CREATE INDEX ix_leave_balance_user_type ON leave_balance_entry
  (organization_id, user_id, leave_type_id, period_year);

CREATE UNIQUE INDEX ux_leave_balance_one_consumption ON leave_balance_entry
  (organization_id, leave_request_id) WHERE kind = 'consumption';
CREATE UNIQUE INDEX ux_leave_balance_one_reversal ON leave_balance_entry
  (organization_id, leave_request_id) WHERE kind = 'reversal';

ALTER TABLE attendance_overlay
  ADD FOREIGN KEY (organization_id, user_id, leave_request_id)
    REFERENCES leave_request (organization_id, user_id, id);

ALTER TABLE work_from_home_day
  ADD COLUMN leave_request_id uuid,
  ADD FOREIGN KEY (organization_id, user_id, leave_request_id)
    REFERENCES leave_request (organization_id, user_id, id);
CREATE INDEX ix_wfh_day_request ON work_from_home_day (organization_id, leave_request_id)
  WHERE leave_request_id IS NOT NULL;

SELECT apply_tenant_rls('leave_type');
SELECT apply_tenant_rls('leave_request');
SELECT apply_tenant_rls('leave_attachment');
SELECT apply_tenant_rls('leave_balance_entry');

REVOKE DELETE ON leave_type FROM tapcrm_app;
REVOKE DELETE ON leave_request FROM tapcrm_app;
REVOKE UPDATE, DELETE ON leave_attachment FROM tapcrm_app;
REVOKE UPDATE, DELETE ON leave_balance_entry FROM tapcrm_app;
