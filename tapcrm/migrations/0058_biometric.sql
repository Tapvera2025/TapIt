-- =====================================================================
-- 0058 - Biometric ingestion: tenant tables (design §10.4, step 5a)
--
-- Connectors, devices, readers, dated PIN mappings, raw punches, alerts,
-- replay requests and review items. Every table is tenant-scoped with RLS
-- and FORCE RLS; nothing here is readable before a tenant context exists.
-- The global serial directory the machine endpoint needs to find a tenant
-- is a separate migration that ships with that endpoint (G2).
--
-- Differences from the §10.4 sketch, per the step 5 plan:
--   * every composite key the sketch implies is declared: a device belongs
--     to its connector, a device-specific mapping to that connector's
--     device, a punch to its device;
--   * duplicate bursts are one person's scans with one meaning in one
--     mode (26 September review), so the neighbour index has no device or
--     PIN in it — device, reader and PIN are provenance, not partitions;
--   * receipt cursors, replay requests and review items get columns.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Connectors and devices
-- ---------------------------------------------------------------------
CREATE TABLE biometric_connector (
  id                    uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id       uuid NOT NULL REFERENCES organization(id),
  kind                  text NOT NULL CHECK (kind IN ('zk-adms', 'zk-security-push', 'edge-agent',
                                                      'vendor-api', 'webhook', 'file-import')),
  vendor                text,
  name                  text NOT NULL CHECK (length(btrim(name)) > 0),
  status                text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  credential_hash       text,                    -- a hash, never the secret
  credential_expires_at timestamptz,
  integration_key       text,                    -- the secret itself lives in the secret store (SE-10)
  ip_allowlist          inet[],
  poll_cursor           jsonb,
  config                jsonb NOT NULL DEFAULT '{}',
  last_success_at       timestamptz,
  last_error            text,
  created_by            uuid NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id)
);

CREATE TABLE biometric_device (
  id                   uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id      uuid NOT NULL REFERENCES organization(id),
  connector_id         uuid NOT NULL,
  serial_number        text NOT NULL CHECK (serial_number ~ '^[A-Za-z0-9._-]{1,64}$'),
  name                 text NOT NULL CHECK (length(btrim(name)) > 0),
  location_label       text,
  status               text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'enabled', 'disabled')),
  dry_run              boolean NOT NULL DEFAULT true,          -- BI-5: every device starts here
  timezone             text NOT NULL,                          -- IANA; checked by the service
  handshake_timezone   text NOT NULL DEFAULT 'derive',         -- 'derive' | 'omit' | an explicit value
  clock_offset_seconds integer NOT NULL DEFAULT 0
                         CHECK (clock_offset_seconds BETWEEN -86400 AND 86400),   -- BI-4
  reader_direction     text NOT NULL DEFAULT 'undirected'
                         CHECK (reader_direction IN ('entry', 'exit', 'both-trusted',
                                                     'alternating', 'undirected')),
  trust_status_keys    boolean NOT NULL DEFAULT false,
  ip_allowlist         inet[],
  backfill_hours       integer NOT NULL DEFAULT 72 CHECK (backfill_hours BETWEEN 1 AND 8760),  -- Q7
  stamp_mode           text NOT NULL DEFAULT 'resend-all' CHECK (stamp_mode IN ('resend-all', 'resume')),
  -- The receipt cursors the device resumes from: written in the transaction that
  -- stores the lines they acknowledge, never before.
  attlog_stamp         text,
  operlog_stamp        text,
  registry_code        text,
  firmware             text,
  push_version         text,
  last_seen_at         timestamptz,
  last_push_at         timestamptz,
  last_skew_seconds    integer,
  last_skew_at         timestamptz,
  created_by           uuid NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, serial_number),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, connector_id, id),              -- a mapping's device is its connector's
  FOREIGN KEY (organization_id, connector_id) REFERENCES biometric_connector (organization_id, id),
  -- A trusted status key is what 'both-trusted' means.
  CHECK (reader_direction <> 'both-trusted' OR trust_status_keys)
);

-- Only for devices whose punches say which reader fired (§10.4).
CREATE TABLE biometric_reader (
  organization_id  uuid NOT NULL,
  device_id        uuid NOT NULL,
  reader_key       text NOT NULL CHECK (length(reader_key) BETWEEN 1 AND 64),
  label            text NOT NULL CHECK (length(btrim(label)) > 0),
  direction        text NOT NULL CHECK (direction IN ('entry', 'exit', 'both-trusted',
                                                      'alternating', 'undirected')),
  PRIMARY KEY (organization_id, device_id, reader_key),
  FOREIGN KEY (organization_id, device_id) REFERENCES biometric_device (organization_id, id)
);

-- ---------------------------------------------------------------------
-- PIN mappings (BI-2 as G15 scopes it)
-- ---------------------------------------------------------------------
-- Within its scope — a connector, or one of its devices — a PIN belongs to one
-- person for each period. The period is end-exclusive and never empty. A device
-- row overrides the connector-wide row for that device (§10.3 step 6), so the
-- two may coexist; the exclusion keys on the device, with a sentinel for the
-- connector-wide scope. The PIN is text: leading zeros are part of it.
CREATE TABLE biometric_pin_mapping (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL REFERENCES organization(id),
  connector_id    uuid NOT NULL,
  device_id       uuid,                    -- NULL: every device on that connector
  pin             text NOT NULL CHECK (pin ~ '^[A-Za-z0-9]{1,32}$'),
  user_id         uuid NOT NULL,
  effective_from  date NOT NULL,
  effective_to    date,                    -- exclusive
  created_by      uuid NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  CHECK (effective_to IS NULL OR effective_to > effective_from),
  EXCLUDE USING gist (organization_id WITH =, connector_id WITH =,
                      coalesce(device_id, '00000000-0000-0000-0000-000000000000'::uuid) WITH =,
                      pin WITH =, daterange(effective_from, effective_to, '[)') WITH &&),
  FOREIGN KEY (organization_id, connector_id) REFERENCES biometric_connector (organization_id, id),
  -- A device-specific row names a device of the same connector. With device_id
  -- NULL the key is not checked (MATCH SIMPLE), as a connector-wide row needs.
  FOREIGN KEY (organization_id, connector_id, device_id)
    REFERENCES biometric_device (organization_id, connector_id, id),
  FOREIGN KEY (organization_id, user_id) REFERENCES app_user (organization_id, id)
);
CREATE INDEX ix_pin_mapping_lookup ON biometric_pin_mapping (organization_id, connector_id, pin, effective_from);
CREATE INDEX ix_pin_mapping_user ON biometric_pin_mapping (organization_id, user_id);

-- ---------------------------------------------------------------------
-- Raw punches (kept with attendance, DP-6)
-- ---------------------------------------------------------------------
CREATE TABLE biometric_punch (
  id                     uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id        uuid NOT NULL REFERENCES organization(id),
  device_id              uuid NOT NULL,
  pin                    text NOT NULL,
  device_local_time      timestamp,              -- the device's own clock reading; NULL when the
                                                  -- source sends only an instant
  occurred_at            timestamptz NOT NULL,
  corrected_at           timestamptz NOT NULL,
  applied_offset_seconds integer NOT NULL,
  received_at            timestamptz NOT NULL DEFAULT now(),
  status_code            text,
  verify_mode            text,
  reader_key             text,
  external_event_id      text,
  raw_line               text NOT NULL,          -- the attendance line only; never biometric material
  -- The reading, taken once when the punch first arrives (D37).
  direction_at_receipt   text NOT NULL CHECK (direction_at_receipt IN ('entry', 'exit', 'both-trusted',
                                                                       'alternating', 'undirected')),
  meaning                text NOT NULL CHECK (meaning IN ('in', 'out', 'break-start', 'break-end', 'scan')),
  dry_run_at_receipt     boolean NOT NULL,
  -- Processing: these move, the columns above never do (trigger below).
  status                 text NOT NULL DEFAULT 'received'
                           CHECK (status IN ('received', 'applied', 'duplicate', 'unmapped',
                                             'dry-run', 'rejected', 'held')),
  status_reason          text,
  duplicate_of           uuid,                   -- the earliest punch of its burst: same person
  user_id                uuid,                   -- the person the PIN resolved to
  pin_mapping_id         uuid,                   -- the mapping that resolved it
  attendance_event_id    uuid,
  replay_count           integer NOT NULL DEFAULT 0 CHECK (replay_count >= 0),
  processing_generation  integer NOT NULL DEFAULT 0 CHECK (processing_generation >= 0),
  processed_at           timestamptz,
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, user_id, id),         -- target of attendance_event.biometric_punch_id and duplicate_of
  FOREIGN KEY (organization_id, device_id) REFERENCES biometric_device (organization_id, id),
  FOREIGN KEY (organization_id, user_id) REFERENCES app_user (organization_id, id),
  FOREIGN KEY (organization_id, pin_mapping_id) REFERENCES biometric_pin_mapping (organization_id, id),
  -- A burst is one person's (D33, D34).
  FOREIGN KEY (organization_id, user_id, duplicate_of)
    REFERENCES biometric_punch (organization_id, user_id, id),
  -- The event a punch became belongs to the person the punch was mapped to (D34).
  FOREIGN KEY (organization_id, user_id, attendance_event_id)
    REFERENCES attendance_event (organization_id, user_id, id),
  CHECK ((status = 'duplicate') = (duplicate_of IS NOT NULL)),
  CHECK (duplicate_of IS NULL OR duplicate_of <> id),
  -- A key with a NULL in it is not checked (MATCH SIMPLE): a linked punch names its person.
  CHECK (attendance_event_id IS NULL OR user_id IS NOT NULL),
  CHECK (duplicate_of IS NULL OR user_id IS NOT NULL),
  CHECK (pin_mapping_id IS NULL OR user_id IS NOT NULL),
  CHECK (status <> 'applied' OR attendance_event_id IS NOT NULL),
  CHECK (status <> 'unmapped' OR user_id IS NULL),
  -- The reading agrees with itself.
  CHECK (direction_at_receipt <> 'entry' OR meaning = 'in'),
  CHECK (direction_at_receipt <> 'exit' OR meaning = 'out'),
  CHECK (direction_at_receipt NOT IN ('alternating', 'undirected') OR meaning = 'scan'),
  -- BI-5: a punch that arrived in dry-run never becomes attendance, and only such a
  -- punch is marked dry-run.
  CHECK (NOT dry_run_at_receipt OR attendance_event_id IS NULL),
  CHECK (status <> 'dry-run' OR dry_run_at_receipt),
  CHECK (date_trunc('second', corrected_at) = corrected_at),
  CHECK (date_trunc('second', occurred_at) = occurred_at)
);
-- A resend is recognised by what the SOURCE sent (§10.3 step 4); ON CONFLICT DO
-- NOTHING over these keeps the reading of the first arrival.
CREATE UNIQUE INDEX ux_biometric_punch_external
  ON biometric_punch (organization_id, device_id, external_event_id) WHERE external_event_id IS NOT NULL;
CREATE UNIQUE INDEX ux_biometric_punch_resend
  ON biometric_punch (organization_id, device_id, coalesce(reader_key, ''), pin, device_local_time,
                      coalesce(status_code, ''))
  WHERE external_event_id IS NULL AND device_local_time IS NOT NULL;
CREATE UNIQUE INDEX ux_biometric_punch_resend_instant
  ON biometric_punch (organization_id, device_id, coalesce(reader_key, ''), pin, occurred_at,
                      coalesce(status_code, ''))
  WHERE external_event_id IS NULL AND device_local_time IS NULL;
-- Burst neighbours: one person, one meaning, one mode, by corrected time — across
-- every device, reader, connector and PIN that resolved to that person.
CREATE INDEX ix_biometric_punch_burst
  ON biometric_punch (organization_id, user_id, meaning, dry_run_at_receipt, corrected_at)
  WHERE user_id IS NOT NULL AND status IN ('applied', 'duplicate', 'dry-run');
CREATE INDEX ix_biometric_punch_stream   ON biometric_punch (organization_id, received_at DESC);
CREATE INDEX ix_biometric_punch_pending  ON biometric_punch (organization_id, received_at)
  WHERE status = 'received';
CREATE INDEX ix_biometric_punch_unmapped ON biometric_punch (organization_id, pin, occurred_at)
  WHERE status = 'unmapped';
CREATE INDEX ix_biometric_punch_device   ON biometric_punch (organization_id, device_id, corrected_at);

-- The frozen reading, and who owns a linked punch.
CREATE FUNCTION biometric_punch_guard() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF (NEW.id, NEW.organization_id, NEW.device_id, NEW.pin, NEW.device_local_time,
      NEW.occurred_at, NEW.corrected_at, NEW.applied_offset_seconds, NEW.received_at,
      NEW.status_code, NEW.verify_mode, NEW.reader_key, NEW.external_event_id, NEW.raw_line,
      NEW.direction_at_receipt, NEW.meaning, NEW.dry_run_at_receipt)
     IS DISTINCT FROM
     (OLD.id, OLD.organization_id, OLD.device_id, OLD.pin, OLD.device_local_time,
      OLD.occurred_at, OLD.corrected_at, OLD.applied_offset_seconds, OLD.received_at,
      OLD.status_code, OLD.verify_mode, OLD.reader_key, OLD.external_event_id, OLD.raw_line,
      OLD.direction_at_receipt, OLD.meaning, OLD.dry_run_at_receipt) THEN
    RAISE EXCEPTION 'biometric_punch: the receipt and its reading are fixed at arrival (D37)'
      USING ERRCODE = 'check_violation';
  END IF;
  -- Once a punch became an event, or joined a burst, its person and those links
  -- stay: clearing a pointer first does not free the owner. Changing it is a
  -- review, not an update.
  IF OLD.attendance_event_id IS NOT NULL
     AND (NEW.attendance_event_id IS DISTINCT FROM OLD.attendance_event_id
          OR NEW.user_id IS DISTINCT FROM OLD.user_id
          OR NEW.pin_mapping_id IS DISTINCT FROM OLD.pin_mapping_id) THEN
    RAISE EXCEPTION 'biometric_punch: an applied punch keeps its event and its person'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.duplicate_of IS NOT NULL
     AND (NEW.duplicate_of IS NULL
          OR NEW.user_id IS DISTINCT FROM OLD.user_id
          OR NEW.pin_mapping_id IS DISTINCT FROM OLD.pin_mapping_id) THEN
    RAISE EXCEPTION 'biometric_punch: a duplicate stays in a burst of the same person'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER biometric_punch_guard BEFORE UPDATE ON biometric_punch
  FOR EACH ROW EXECUTE FUNCTION biometric_punch_guard();

-- The key attendance_event.biometric_punch_id has waited for since 0050: a device
-- event belongs to the person its punch was mapped to (D34). NOT VALID: it checks
-- every row written from now on. Device rows written before this migration can only
-- be test data (nothing ingested punches before step 5); VALIDATE CONSTRAINT once a
-- database has none.
ALTER TABLE attendance_event
  ADD CONSTRAINT attendance_event_biometric_punch_fkey
  FOREIGN KEY (organization_id, user_id, biometric_punch_id)
  REFERENCES biometric_punch (organization_id, user_id, id) NOT VALID;

-- ---------------------------------------------------------------------
-- Alerts, replay requests, review items
-- ---------------------------------------------------------------------
CREATE TABLE biometric_alert (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL REFERENCES organization(id),
  device_id       uuid NOT NULL,
  kind            text NOT NULL CHECK (kind IN ('silent', 'skew', 'timezone-suspect',
                                                'biometric-data-received', 'new-source-ip')),
  detail          jsonb NOT NULL DEFAULT '{}',
  opened_at       timestamptz NOT NULL DEFAULT now(),
  notified_at     timestamptz,
  resolved_at     timestamptz,
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, device_id) REFERENCES biometric_device (organization_id, id),
  CHECK (resolved_at IS NULL OR resolved_at >= opened_at)
);
-- One open alert of a kind per device.
CREATE UNIQUE INDEX ux_biometric_alert_open
  ON biometric_alert (organization_id, device_id, kind) WHERE resolved_at IS NULL;

-- An HR replay: what was selected, why, and how far it got. Each request is a new
-- generation, so its jobs never collide with an earlier run's keys.
CREATE TABLE biometric_replay_request (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL REFERENCES organization(id),
  requested_by    uuid NOT NULL,
  reason          text NOT NULL CHECK (length(btrim(reason)) > 0),
  punch_ids       uuid[] CHECK (cardinality(punch_ids) BETWEEN 1 AND 500),
  device_id       uuid,
  pin             text,
  user_id         uuid,
  from_date       date NOT NULL,
  to_date         date NOT NULL,                -- inclusive
  release_hold    boolean NOT NULL DEFAULT false,
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'done', 'failed')),
  selected_count  integer NOT NULL DEFAULT 0 CHECK (selected_count >= 0),
  processed_count integer NOT NULL DEFAULT 0 CHECK (processed_count >= 0),
  last_punch_id   uuid,                         -- progress cursor
  last_error      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  finished_at     timestamptz,
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, device_id) REFERENCES biometric_device (organization_id, id),
  FOREIGN KEY (organization_id, user_id) REFERENCES app_user (organization_id, id),
  CHECK (to_date >= from_date AND to_date - from_date <= 92),
  CHECK ((status IN ('done', 'failed')) = (finished_at IS NOT NULL))
);
CREATE INDEX ix_biometric_replay_open ON biometric_replay_request (organization_id, created_at)
  WHERE status IN ('pending', 'running');

-- Something a person must decide: a protected head, a mapping edited under
-- applied punches, a person not employed on the date.
CREATE TABLE biometric_review_item (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL REFERENCES organization(id),
  punch_id        uuid NOT NULL,
  kind            text NOT NULL CHECK (kind IN ('protected-head', 'mapping-changed', 'not-employed',
                                                'other-person', 'not-a-device-event')),
  detail          jsonb NOT NULL DEFAULT '{}',
  opened_at       timestamptz NOT NULL DEFAULT now(),
  resolved_at     timestamptz,
  resolved_by     uuid,
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, punch_id) REFERENCES biometric_punch (organization_id, id),
  CHECK ((resolved_at IS NULL) = (resolved_by IS NULL))
);
CREATE UNIQUE INDEX ux_biometric_review_open
  ON biometric_review_item (organization_id, punch_id, kind) WHERE resolved_at IS NULL;

-- ---------------------------------------------------------------------
-- Tenant isolation and privileges
-- ---------------------------------------------------------------------
SELECT apply_tenant_rls('biometric_connector');
SELECT apply_tenant_rls('biometric_device');
SELECT apply_tenant_rls('biometric_reader');
SELECT apply_tenant_rls('biometric_pin_mapping');
SELECT apply_tenant_rls('biometric_punch');
SELECT apply_tenant_rls('biometric_alert');
SELECT apply_tenant_rls('biometric_replay_request');
SELECT apply_tenant_rls('biometric_review_item');

-- 0001's default privileges give the app role everything; these narrow it.
REVOKE DELETE ON biometric_connector FROM tapcrm_app;        -- disabled, never removed
REVOKE DELETE ON biometric_device FROM tapcrm_app;           -- disabled, never removed
REVOKE DELETE ON biometric_pin_mapping FROM tapcrm_app;      -- ended by effective_to: replays need the history
REVOKE DELETE ON biometric_punch FROM tapcrm_app;            -- receipts are kept with attendance (DP-6)
REVOKE DELETE ON biometric_alert FROM tapcrm_app;            -- resolved, never removed
REVOKE DELETE ON biometric_replay_request FROM tapcrm_app;
REVOKE DELETE ON biometric_review_item FROM tapcrm_app;
