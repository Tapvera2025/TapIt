-- =====================================================================
-- 0055 - user_status (§9.3): live-status's projection.
--
-- One row per person, whatever their current day is. The state machine
-- and the `apply`/`refresh` decision live in code; this table only stores
-- the last derived answer.
--
-- The app role has no write access at all: every writer is the projector,
-- called from within `AttendanceFacade.appendEvent` (fast path) or the
-- rollover sweeper (per-user refresh). There is no manual correction
-- surface (LS-9). REVOKE tightens the migration-0001 default.
-- =====================================================================

CREATE TABLE user_status (
  organization_id         uuid NOT NULL REFERENCES organization(id),
  user_id                 uuid NOT NULL,
  work_date               date NOT NULL,
  state                   text NOT NULL CHECK (state IN ('NOT_IN', 'WORKING', 'ON_BREAK', 'FINISHED')),
  since                   timestamptz,
  last_event_at           timestamptz,
  worked_minutes          integer NOT NULL DEFAULT 0,
  break_minutes           integer NOT NULL DEFAULT 0,
  presence_confidence     text NOT NULL DEFAULT 'confirmed'
                            CHECK (presence_confidence IN ('confirmed', 'assumed')),
  last_scan_at            timestamptz,
  last_scan_device        text,
  likely_finished_at      timestamptz,
  is_wfh                  boolean NOT NULL DEFAULT false,
  day_group               text CHECK (day_group IN ('leave', 'holiday')),
  shift_start_at          timestamptz,
  shift_end_at            timestamptz,
  window_start            timestamptz NOT NULL,
  window_end              timestamptz NOT NULL,
  rollover_due_at         timestamptz NOT NULL,
  grace_minutes           integer,
  flexible_target_minutes integer,
  updated_at              timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id),
  FOREIGN KEY (organization_id, user_id) REFERENCES app_user (organization_id, id)
);

CREATE INDEX ix_user_status_rollover ON user_status (organization_id, rollover_due_at);
CREATE INDEX ix_user_status_state    ON user_status (organization_id, state, work_date);

SELECT apply_tenant_rls('user_status');

-- LS-9: no route writes here. The projector is the sole writer, and it
-- uses the platform ('system') role for its writes. Migration 0001 grants
-- the app role SELECT/INSERT/UPDATE/DELETE by default; tighten to SELECT
-- only.
REVOKE INSERT, UPDATE, DELETE ON user_status FROM tapcrm_app;
