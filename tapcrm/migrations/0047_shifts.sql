-- =====================================================================
-- 0047 - Shifts (attendance design, step 1, §6.1)
--
-- Every table is tenant-owned: composite tenant keys, apply_tenant_rls,
-- and the app role gets only the privileges its writes need. Where two
-- rows both belong to a person, the key carries user_id as well (D34).
-- =====================================================================

-- Templates. SH-5: deactivated, never deleted, so the app role has no DELETE.
CREATE TABLE shift (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL REFERENCES organization(id),
  code            text NOT NULL CHECK (length(trim(code)) > 0),
  name            text NOT NULL CHECK (length(trim(name)) > 0),
  kind            text NOT NULL CHECK (kind IN ('fixed', 'flexible')),
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_by      uuid NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, code),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, created_by) REFERENCES app_user (organization_id, id)
);

-- SH-2: editing a template writes a new version; nothing before its date changes.
CREATE TABLE shift_version (
  id                            uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id               uuid NOT NULL REFERENCES organization(id),
  shift_id                      uuid NOT NULL,
  effective_from                date NOT NULL,
  start_time                    time,              -- fixed only
  end_time                      time,              -- fixed only; end < start means overnight
  grace_minutes                 integer NOT NULL CHECK (grace_minutes BETWEEN 0 AND 240),
  early_exit_grace_minutes      integer NOT NULL DEFAULT 0 CHECK (early_exit_grace_minutes BETWEEN 0 AND 240),
  full_day_minutes              integer NOT NULL,  -- D6: HR enters it (Q1)
  half_day_minutes              integer NOT NULL,
  complementary_half_minutes    integer,           -- §8.3; NULL means half_day_minutes ÷ 2
  min_overtime_minutes          integer CHECK (min_overtime_minutes >= 0),  -- AT-5; NULL: not tracked
  early_window_minutes          integer NOT NULL DEFAULT 180 CHECK (early_window_minutes BETWEEN 0 AND 720),
  max_closing_extension_minutes integer CHECK (max_closing_extension_minutes BETWEEN 0 AND 720),  -- NULL: shift_setting's
  created_by                    uuid NOT NULL,
  created_at                    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, shift_id, effective_from),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, shift_id) REFERENCES shift (organization_id, id),
  FOREIGN KEY (organization_id, created_by) REFERENCES app_user (organization_id, id),
  CHECK (half_day_minutes > 0 AND half_day_minutes < full_day_minutes),
  CHECK (complementary_half_minutes IS NULL OR complementary_half_minutes > 0),
  -- Both times or neither. Equal times are a typing slip, not a 24-hour shift (§6.6).
  CHECK ((start_time IS NULL) = (end_time IS NULL)),
  CHECK (start_time IS NULL OR start_time <> end_time)
);

CREATE TABLE shift_rotation (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL REFERENCES organization(id),
  name            text NOT NULL CHECK (length(trim(name)) > 0),
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_by      uuid NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, created_by) REFERENCES app_user (organization_id, id)
);

-- ISO weekday: 1 Monday … 7 Sunday. A NULL shift is a weekday with no shift.
CREATE TABLE shift_rotation_day (
  organization_id uuid NOT NULL REFERENCES organization(id),
  rotation_id     uuid NOT NULL,
  weekday         smallint NOT NULL CHECK (weekday BETWEEN 1 AND 7),
  shift_id        uuid,
  PRIMARY KEY (organization_id, rotation_id, weekday),
  FOREIGN KEY (organization_id, rotation_id) REFERENCES shift_rotation (organization_id, id),
  FOREIGN KEY (organization_id, shift_id) REFERENCES shift (organization_id, id)
);

-- Chain steps 2, 4 and 5. One assignment per kind per person per date.
CREATE TABLE shift_assignment (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL REFERENCES organization(id),
  user_id         uuid NOT NULL,
  kind            text NOT NULL CHECK (kind IN ('template', 'rotation', 'permanent-flexible')),
  shift_id        uuid,
  rotation_id     uuid,
  effective_from  date NOT NULL,
  effective_to    date,                         -- exclusive; NULL = open-ended
  reason          text,
  created_by      uuid NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, user_id) REFERENCES app_user (organization_id, id),
  FOREIGN KEY (organization_id, shift_id) REFERENCES shift (organization_id, id),
  FOREIGN KEY (organization_id, rotation_id) REFERENCES shift_rotation (organization_id, id),
  FOREIGN KEY (organization_id, created_by) REFERENCES app_user (organization_id, id),
  CHECK ((kind = 'template') = (shift_id IS NOT NULL)),
  CHECK ((kind = 'rotation') = (rotation_id IS NOT NULL)),
  CHECK (effective_to IS NULL OR effective_to > effective_from),
  EXCLUDE USING gist (organization_id WITH =, user_id WITH =, kind WITH =,
                      daterange(effective_from, effective_to, '[)') WITH &&)
);

CREATE TABLE shift_request (
  id                 uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id    uuid NOT NULL REFERENCES organization(id),
  user_id            uuid NOT NULL,
  kind               text NOT NULL CHECK (kind IN ('flexible', 'change')),
  from_date          date NOT NULL,
  to_date            date NOT NULL,
  requested_shift_id uuid,                      -- change only
  reason             text NOT NULL CHECK (length(trim(reason)) > 0),
  status             text NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  requested_by       uuid NOT NULL,             -- the registry initiator field for shifts:approve
  decided_by         uuid,
  decided_at         timestamptz,
  decision_note      text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, user_id, id),        -- the override made from it points here (D34)
  FOREIGN KEY (organization_id, user_id) REFERENCES app_user (organization_id, id),
  FOREIGN KEY (organization_id, requested_by) REFERENCES app_user (organization_id, id),
  FOREIGN KEY (organization_id, decided_by) REFERENCES app_user (organization_id, id),
  FOREIGN KEY (organization_id, requested_shift_id) REFERENCES shift (organization_id, id),
  CHECK ((kind = 'change') = (requested_shift_id IS NOT NULL)),
  CHECK (to_date >= from_date AND to_date - from_date <= 31),
  CHECK ((status = 'pending') = (decided_by IS NULL)),
  CHECK (decided_by IS NULL OR decided_by <> requested_by)  -- A1 in the database (SH-7)
);

-- Chain step 1. Created by HR, or by an approved change request.
CREATE TABLE shift_override (
  id                uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id   uuid NOT NULL REFERENCES organization(id),
  user_id           uuid NOT NULL,
  work_date         date NOT NULL,
  kind              text NOT NULL CHECK (kind IN ('shift', 'flexible', 'no-shift')),
  shift_id          uuid,
  reason            text NOT NULL CHECK (length(trim(reason)) > 0),
  origin_request_id uuid,                       -- removed together with its request
  created_by        uuid NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, user_id, work_date),
  FOREIGN KEY (organization_id, user_id) REFERENCES app_user (organization_id, id),
  FOREIGN KEY (organization_id, shift_id) REFERENCES shift (organization_id, id),
  FOREIGN KEY (organization_id, created_by) REFERENCES app_user (organization_id, id),
  -- An override made by approving a request belongs to the request's person (D34).
  FOREIGN KEY (organization_id, user_id, origin_request_id)
    REFERENCES shift_request (organization_id, user_id, id),
  CHECK ((kind = 'shift') = (shift_id IS NOT NULL))
);

-- Chain step 6.
CREATE TABLE department_shift_default (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL REFERENCES organization(id),
  department_id   uuid NOT NULL,
  shift_id        uuid NOT NULL,
  effective_from  date NOT NULL,
  effective_to    date,                         -- exclusive; NULL = open-ended
  created_by      uuid NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, department_id) REFERENCES department (organization_id, id),
  FOREIGN KEY (organization_id, shift_id) REFERENCES shift (organization_id, id),
  FOREIGN KEY (organization_id, created_by) REFERENCES app_user (organization_id, id),
  CHECK (effective_to IS NULL OR effective_to > effective_from),
  EXCLUDE USING gist (organization_id WITH =, department_id WITH =,
                      daterange(effective_from, effective_to, '[)') WITH &&)
);

-- Organization-wide settings, dated like a shift version (D35): a day is always
-- judged by the row in force on its date. Q3 has no default, so there is no row
-- until HR answers it (G14: until a settings route exists, a seed writes it).
CREATE TABLE shift_setting (
  id                            uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id               uuid NOT NULL REFERENCES organization(id),
  effective_from                date NOT NULL,
  day_start_time                time NOT NULL DEFAULT '00:00',   -- the last boundary anchor (§5.2)
  max_closing_extension_minutes integer NOT NULL
                                  CHECK (max_closing_extension_minutes BETWEEN 0 AND 720),
  minimum_rest_minutes          integer CHECK (minimum_rest_minutes > 0),  -- NULL: no rest warning
  night_consent_mode            text NOT NULL DEFAULT 'refuse' CHECK (night_consent_mode IN ('refuse', 'warn')),
  night_consent_from            time,                              -- Q14: NULL = no consent check
  night_consent_to              time,
  created_by                    uuid NOT NULL,
  created_at                    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, effective_from),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, created_by) REFERENCES app_user (organization_id, id),
  CHECK ((night_consent_from IS NULL) = (night_consent_to IS NULL))
);

CREATE INDEX ix_shift_assignment_user ON shift_assignment (organization_id, user_id, effective_from);
CREATE INDEX ix_shift_override_user ON shift_override (organization_id, user_id, work_date);
CREATE INDEX ix_shift_request_status ON shift_request (organization_id, status, from_date);

SELECT apply_tenant_rls('shift');
SELECT apply_tenant_rls('shift_version');
SELECT apply_tenant_rls('shift_rotation');
SELECT apply_tenant_rls('shift_rotation_day');
SELECT apply_tenant_rls('shift_assignment');
SELECT apply_tenant_rls('shift_request');
SELECT apply_tenant_rls('shift_override');
SELECT apply_tenant_rls('department_shift_default');
SELECT apply_tenant_rls('shift_setting');

GRANT SELECT, INSERT, UPDATE ON shift TO tapcrm_app;
GRANT SELECT, INSERT ON shift_version TO tapcrm_app;              -- a change is a new version
GRANT SELECT, INSERT, UPDATE ON shift_rotation TO tapcrm_app;
GRANT SELECT, INSERT ON shift_rotation_day TO tapcrm_app;
GRANT SELECT, INSERT, UPDATE ON shift_assignment TO tapcrm_app;   -- ending one sets effective_to
GRANT SELECT, INSERT, UPDATE ON shift_request TO tapcrm_app;
GRANT SELECT, INSERT, DELETE ON shift_override TO tapcrm_app;     -- overrides go with their request
GRANT SELECT, INSERT, UPDATE ON department_shift_default TO tapcrm_app;
GRANT SELECT, INSERT ON shift_setting TO tapcrm_app;              -- a change is a new dated row
