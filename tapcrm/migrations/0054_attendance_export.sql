-- =====================================================================
-- 0054 - Attendance export requests (attendance design §8.7, SE-6, AT-14)
--
-- One row per POST /api/attendance/export. The POST freezes who is in the
-- export (`user_ids`, the caller's scope at that moment, narrowed by any
-- people they named); the background job reads only that list. The job
-- moves the row queued → running → completed | failed and records where the
-- file is. GET /api/attendance/exports/:jobId reads it back, and hands out a
-- short-lived signed link only once the file exists.
-- =====================================================================

CREATE TABLE attendance_export_request (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id  uuid NOT NULL REFERENCES organization(id),
  requested_by     uuid NOT NULL,
  from_date        date NOT NULL,
  to_date          date NOT NULL,
  user_ids         uuid[] NOT NULL,            -- frozen at request time; never re-evaluated
  status           text NOT NULL DEFAULT 'queued'
                     CHECK (status IN ('queued', 'running', 'completed', 'failed')),
  object_key       text,                       -- set when completed
  row_count        integer,
  error_message    text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  completed_at     timestamptz,
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, requested_by) REFERENCES app_user (organization_id, id),
  CHECK (to_date >= from_date),
  CHECK (cardinality(user_ids) > 0),
  CHECK ((status = 'completed') = (object_key IS NOT NULL))
);
CREATE INDEX ix_attendance_export_requested_by ON attendance_export_request (organization_id, requested_by);

SELECT apply_tenant_rls('attendance_export_request');

-- Migration 0001 grants everything by default; a request is kept, never removed.
REVOKE DELETE ON attendance_export_request FROM tapcrm_app;
