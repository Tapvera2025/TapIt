-- =====================================================================
-- 0050 - Attendance core (attendance design, step 3, §8.1)
--
-- The event ledger (append-only), one record per person per day, the
-- stored answer to "which day owns this event", and the dated settings a
-- day is judged by. Every link between two of one person's rows carries
-- user_id (D34), so the database refuses a punch on a colleague's day.
-- =====================================================================

CREATE TABLE attendance_event (                 -- append-only (AT-6)
  id                  uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id     uuid NOT NULL REFERENCES organization(id),
  user_id             uuid NOT NULL,
  kind                text NOT NULL
                        CHECK (kind IN ('in', 'out', 'break-start', 'break-end', 'scan', 'auto-out')),
  occurred_at         timestamptz NOT NULL,       -- corrected instant; the owning day is an assignment
  source              text NOT NULL
                        CHECK (source IN ('device', 'web', 'mobile', 'correction', 'system', 'import')),
  evidence            text NOT NULL CHECK (evidence IN ('confirmed', 'assumed')),   -- D29
  biometric_punch_id  uuid,                       -- source = device; its foreign key arrives in step 5
  correction_id       uuid,                       -- source = correction; its foreign key arrives in step 7
  supersedes_event_id uuid,                       -- the earlier event this one replaces or voids
  is_void             boolean NOT NULL DEFAULT false,
  remote              boolean NOT NULL DEFAULT false,   -- a web or mobile punch
  client_event_id     text,                       -- offline idempotency (NF-19, TX-7)
  client_request_hash text,                       -- same key + different request = 409
  client_time         timestamptz,                -- what an offline client said (D13)
  recorded_by         uuid,                       -- NULL for device and system events
  recorded_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, user_id, id),          -- target key for same-person supersession
  FOREIGN KEY (organization_id, user_id) REFERENCES app_user (organization_id, id),
  FOREIGN KEY (organization_id, user_id, supersedes_event_id)
    REFERENCES attendance_event (organization_id, user_id, id),
  -- Only a correction or the system supersedes; a device or web punch is a fact.
  CHECK (supersedes_event_id IS NULL OR source IN ('correction', 'system')),
  CHECK ((source = 'device') = (biometric_punch_id IS NOT NULL)),
  CHECK (source <> 'correction' OR correction_id IS NOT NULL),
  CHECK (correction_id IS NULL OR source IN ('correction', 'system')),
  CHECK (NOT is_void OR supersedes_event_id IS NOT NULL),
  CHECK (supersedes_event_id IS NULL OR supersedes_event_id <> id),
  -- A scan and a system auto-out are never confirmed; a web or mobile punch always is.
  CHECK (kind NOT IN ('scan', 'auto-out') OR evidence = 'assumed'),
  CHECK (source NOT IN ('web', 'mobile') OR evidence = 'confirmed'),
  -- A correction states an arrival, departure or break, always confirmed; a void row copies its target.
  CHECK (source <> 'correction' OR is_void
         OR (evidence = 'confirmed' AND kind IN ('in', 'out', 'break-start', 'break-end'))),
  -- Whole seconds (T-6).
  CHECK (date_trunc('second', occurred_at) = occurred_at)
);
CREATE INDEX ix_attendance_event_user_time ON attendance_event (organization_id, user_id, occurred_at);
CREATE UNIQUE INDEX ux_attendance_event_client
  ON attendance_event (organization_id, user_id, client_event_id) WHERE client_event_id IS NOT NULL;
-- One chain, never a fork: an event is superseded or retracted once, and once only.
CREATE UNIQUE INDEX ux_attendance_event_supersedes
  ON attendance_event (organization_id, supersedes_event_id) WHERE supersedes_event_id IS NOT NULL;

CREATE TABLE attendance_record (
  id                       uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id          uuid NOT NULL REFERENCES organization(id),
  user_id                  uuid NOT NULL,
  work_date                date NOT NULL,
  window_start             timestamptz NOT NULL,  -- §5.2
  window_end               timestamptz NOT NULL,
  state                    text NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'closed')),
  close_due_at             timestamptz NOT NULL,  -- = closingCap (§5.2); NOT capped by window_end
  shift_snapshot           jsonb NOT NULL,        -- ResolvedShift (SH-2, AT-I2)
  shift_source             text NOT NULL,
  placement_snapshot       jsonb NOT NULL,        -- department, team and position when materialised
  day_type                 text NOT NULL CHECK (day_type IN ('working', 'week-off', 'holiday', 'not-employed')),
  status                   text CHECK (status IN ('present', 'half-day', 'absent', 'leave', 'half-day-leave',
                                                  'holiday', 'not-evaluated', 'not-employed')),
  present_units            smallint NOT NULL DEFAULT 0,   -- half-day units (D7)
  paid_leave_units         smallint NOT NULL DEFAULT 0,
  unpaid_leave_units       smallint NOT NULL DEFAULT 0,
  absent_units             smallint NOT NULL DEFAULT 0,
  holiday_units            smallint NOT NULL DEFAULT 0,
  worked_minutes           integer NOT NULL DEFAULT 0,
  break_minutes            integer NOT NULL DEFAULT 0,
  late_minutes             integer NOT NULL DEFAULT 0,
  early_exit_minutes       integer NOT NULL DEFAULT 0,
  overtime_minutes         integer NOT NULL DEFAULT 0,
  night_minutes            integer NOT NULL DEFAULT 0,    -- §6.6
  arrival_at               timestamptz,                   -- readDay's arrival and departure (§5.3)
  departure_at             timestamptz,
  is_wfh                   boolean NOT NULL DEFAULT false,
  flags                    text[] NOT NULL DEFAULT '{}',
  -- Flags attribution raises about this day (previous-session-unconfirmed,
  -- overlapping-arrival). Written by the re-attribution pass; the calculator
  -- (step 3b) copies them into `flags`.
  attribution_flags        text[] NOT NULL DEFAULT '{}',
  provenance               jsonb NOT NULL DEFAULT '{}',   -- AT-12
  input_version            integer NOT NULL DEFAULT 1,    -- bumped by every input change
  calculated_input_version integer NOT NULL DEFAULT 0,
  calculation_version      integer NOT NULL DEFAULT 0,    -- AT-I3
  breaks_evaluated_version integer,                       -- break-management's watermark (§13)
  rules_version            text NOT NULL DEFAULT 'uncalculated',  -- the calculator's code version
  calculated_at            timestamptz,
  closed_at                timestamptz,
  closed_by                text CHECK (closed_by IN ('punch-out', 'auto-close', 'no-show', 'correction')),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, user_id, id),                 -- the assignment's same-person key (D34)
  UNIQUE (organization_id, user_id, work_date),          -- ux_attendance_day (TECH §5.5)
  FOREIGN KEY (organization_id, user_id) REFERENCES app_user (organization_id, id),
  CHECK (window_end > window_start),
  CHECK (present_units + paid_leave_units + unpaid_leave_units + absent_units + holiday_units
         = CASE WHEN status IS NULL OR status IN ('not-evaluated', 'not-employed') THEN 0 ELSE 2 END)
);
CREATE INDEX ix_attendance_date     ON attendance_record (organization_id, work_date);
CREATE INDEX ix_attendance_open_due ON attendance_record (organization_id, close_due_at) WHERE state = 'open';
CREATE INDEX ix_attendance_stale    ON attendance_record (organization_id, user_id)
  WHERE calculated_input_version < input_version;

-- Which day owns an event, and why. Derived, so unlike the event it can be
-- rewritten when a later change moves an event across a boundary (§8.4).
CREATE TABLE attendance_event_assignment (
  organization_id      uuid NOT NULL REFERENCES organization(id),
  user_id              uuid NOT NULL,             -- whose event, and whose day: one person
  event_id             uuid NOT NULL,
  attendance_record_id uuid NOT NULL,
  reason               text NOT NULL CHECK (reason IN ('midpoint', 'closing-extension',
                                                       'opening-pull-forward', 'next-shift-started',
                                                       'system-close', 'reconciliation',
                                                       'correction', 'import')),
  pinned               boolean NOT NULL,
  assignment_version   integer NOT NULL DEFAULT 1,
  assigned_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, event_id),
  FOREIGN KEY (organization_id, user_id, event_id)
    REFERENCES attendance_event  (organization_id, user_id, id),
  FOREIGN KEY (organization_id, user_id, attendance_record_id)
    REFERENCES attendance_record (organization_id, user_id, id),
  CHECK (pinned = (reason IN ('correction', 'system-close', 'reconciliation')))
);
CREATE INDEX ix_event_assignment_record ON attendance_event_assignment (organization_id, attendance_record_id);

-- Leave, WFH and confirmed break consequences, each pointing at what created it (L8).
-- The foreign keys to leave_request and break_breach arrive with steps 6 and 8.
CREATE TABLE attendance_overlay (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id  uuid NOT NULL REFERENCES organization(id),
  user_id          uuid NOT NULL,
  work_date        date NOT NULL,
  kind             text NOT NULL CHECK (kind IN ('leave-full', 'leave-first-half', 'leave-second-half',
                                                 'wfh', 'breach-consequence')),
  paid             boolean,
  consequence      text CHECK (consequence IN ('mark-late', 'mark-half-day', 'mark-absent', 'deduct-minutes')),
  minutes          integer,
  leave_request_id uuid,
  break_breach_id  uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, user_id) REFERENCES app_user (organization_id, id),
  CHECK (num_nonnulls(leave_request_id, break_breach_id) = 1),
  CHECK ((kind = 'breach-consequence') = (break_breach_id IS NOT NULL)),
  UNIQUE NULLS NOT DISTINCT (organization_id, user_id, work_date, kind, leave_request_id, break_breach_id)
);
CREATE INDEX ix_attendance_overlay_leave  ON attendance_overlay (organization_id, leave_request_id);
CREATE INDEX ix_attendance_overlay_breach ON attendance_overlay (organization_id, break_breach_id);

-- Dated settings (D35): a day is judged by the row in force on its date.
CREATE TABLE attendance_setting (
  id                            uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id               uuid NOT NULL REFERENCES organization(id),
  effective_from                date NOT NULL,
  arrival_policy                text NOT NULL DEFAULT 'device-or-web'
                                  CHECK (arrival_policy IN ('device-or-web', 'device')),   -- D10, Q6
  client_time_tolerance_minutes integer NOT NULL DEFAULT 15
                                  CHECK (client_time_tolerance_minutes BETWEEN 0 AND 1440),  -- D13
  night_window_from             time,                   -- §6.6, Q13: NULL = no night minutes
  night_window_to               time,
  created_by                    uuid NOT NULL,
  created_at                    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, effective_from),
  FOREIGN KEY (organization_id, created_by) REFERENCES app_user (organization_id, id),
  CHECK ((night_window_from IS NULL) = (night_window_to IS NULL)),
  CHECK (night_window_from IS NULL OR night_window_from <> night_window_to)
);

CREATE TABLE arrival_policy_override (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL REFERENCES organization(id),
  department_id   uuid NOT NULL,
  arrival_policy  text NOT NULL CHECK (arrival_policy IN ('device-or-web', 'device')),
  effective_from  date NOT NULL,
  effective_to    date,                                 -- exclusive; NULL = open-ended
  created_by      uuid NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, department_id) REFERENCES department (organization_id, id),
  FOREIGN KEY (organization_id, created_by) REFERENCES app_user (organization_id, id),
  CHECK (effective_to IS NULL OR effective_to > effective_from),
  EXCLUDE USING gist (organization_id WITH =, department_id WITH =,
                      daterange(effective_from, effective_to, '[)') WITH &&)
);

-- The one other way through a `device` policy: a dated, audited allowance (§9.2).
CREATE TABLE arrival_exception (
  organization_id uuid NOT NULL REFERENCES organization(id),
  user_id         uuid NOT NULL,
  work_date       date NOT NULL,
  reason          text NOT NULL CHECK (char_length(reason) >= 20),
  granted_by      uuid NOT NULL,
  granted_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id, work_date),
  FOREIGN KEY (organization_id, user_id) REFERENCES app_user (organization_id, id),
  FOREIGN KEY (organization_id, granted_by) REFERENCES app_user (organization_id, id),
  CHECK (granted_by <> user_id)                         -- nobody excuses their own arrival
);

-- Day-open's watermark (§8.6): the last date fully materialised.
CREATE TABLE attendance_day_open_state (
  organization_id      uuid PRIMARY KEY REFERENCES organization(id),
  materialised_through date NOT NULL
);

SELECT apply_tenant_rls('attendance_event');
SELECT apply_tenant_rls('attendance_record');
SELECT apply_tenant_rls('attendance_event_assignment');
SELECT apply_tenant_rls('attendance_overlay');
SELECT apply_tenant_rls('attendance_setting');
SELECT apply_tenant_rls('arrival_policy_override');
SELECT apply_tenant_rls('arrival_exception');
SELECT apply_tenant_rls('attendance_day_open_state');

-- Migration 0001 grants SELECT, INSERT, UPDATE and DELETE on every new table to
-- the app role by default, so a narrower grant is written as a REVOKE.
REVOKE UPDATE, DELETE ON attendance_event FROM tapcrm_app;          -- append-only (AT-6)
REVOKE DELETE ON attendance_record FROM tapcrm_app;                 -- a day is marked, never removed (§8.6)
REVOKE UPDATE ON attendance_overlay FROM tapcrm_app;                -- overlays go with their request (L8)
REVOKE UPDATE, DELETE ON attendance_setting FROM tapcrm_app;        -- a change is a new dated row (D35)
REVOKE DELETE ON arrival_policy_override FROM tapcrm_app;
REVOKE UPDATE, DELETE ON arrival_exception FROM tapcrm_app;
REVOKE DELETE ON attendance_day_open_state FROM tapcrm_app;
-- attendance_event_assignment keeps all four: it is derived, and re-attribution rewrites it.
