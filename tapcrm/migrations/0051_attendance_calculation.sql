-- =====================================================================
-- 0051 - Attendance calculation (attendance design, step 3b, §8.1, §8.5)
--
-- 1. attendance_month_summary: one row per person per month, derived from
--    attendance_record in the same transaction as each recalculation, and
--    rebuildable at any time. Monthly screens read it, which keeps them inside
--    their time budget. There is no night-day count: what makes a night is
--    payroll's threshold (§6.6).
-- 2. attendance_record.input_changed_at: when the day's inputs last changed.
--    The stale sweeper re-queues a day only after it has been stale for a
--    minute (§8.5), so it does not race the normal path.
-- 3. attendance_refresh_request: one person's share of a shift or holiday
--    change. The outbox handler writes it, the refresh job completes it, and
--    the sweeper offers it again until it is done (§5.4 generations). From
--    the moment it is written, the change cannot be lost.
-- =====================================================================

CREATE TABLE attendance_month_summary (
  organization_id     uuid NOT NULL REFERENCES organization(id),
  user_id             uuid NOT NULL,
  month               date NOT NULL CHECK (extract(day FROM month) = 1),
  days                integer NOT NULL DEFAULT 0,
  present_units       integer NOT NULL DEFAULT 0,
  paid_leave_units    integer NOT NULL DEFAULT 0,
  unpaid_leave_units  integer NOT NULL DEFAULT 0,
  absent_units        integer NOT NULL DEFAULT 0,
  holiday_units       integer NOT NULL DEFAULT 0,
  worked_minutes      integer NOT NULL DEFAULT 0,
  late_days           integer NOT NULL DEFAULT 0,
  late_minutes        integer NOT NULL DEFAULT 0,
  overtime_minutes    integer NOT NULL DEFAULT 0,
  night_minutes       integer NOT NULL DEFAULT 0,
  wfh_days            integer NOT NULL DEFAULT 0,
  open_days           integer NOT NULL DEFAULT 0,
  not_evaluated_days  integer NOT NULL DEFAULT 0,
  stale_days          integer NOT NULL DEFAULT 0,        -- recalculation pending
  updated_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id, month),
  FOREIGN KEY (organization_id, user_id) REFERENCES app_user (organization_id, id)
);

SELECT apply_tenant_rls('attendance_month_summary');

-- Migration 0001 grants everything by default; a summary is rewritten, never removed.
REVOKE DELETE ON attendance_month_summary FROM tapcrm_app;

ALTER TABLE attendance_record ADD COLUMN input_changed_at timestamptz NOT NULL DEFAULT now();

CREATE TABLE attendance_refresh_request (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id  uuid NOT NULL REFERENCES organization(id),
  user_id          uuid NOT NULL,
  source_event_id  uuid NOT NULL,                 -- the domain_outbox row that asked
  from_date        date NOT NULL,
  to_date          date,                          -- inclusive; NULL for no end
  requested_at     timestamptz NOT NULL DEFAULT now(),
  completed_at     timestamptz,
  failed_at        timestamptz,                   -- the third generation failed: a person must look
  replays          integer NOT NULL DEFAULT 0,    -- raised by a person to run a failed request again
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, source_event_id, user_id),  -- a second delivery adds nothing
  FOREIGN KEY (organization_id, user_id) REFERENCES app_user (organization_id, id),
  CHECK (to_date IS NULL OR to_date >= from_date),
  CHECK (completed_at IS NULL OR failed_at IS NULL)
);
CREATE INDEX ix_attendance_refresh_pending ON attendance_refresh_request (organization_id, id)
  WHERE completed_at IS NULL AND failed_at IS NULL;

SELECT apply_tenant_rls('attendance_refresh_request');

-- A request is completed or failed, never removed.
REVOKE DELETE ON attendance_refresh_request FROM tapcrm_app;
