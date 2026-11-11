-- Call Analytics (Sales): JustCall and Aircall integration.
--
-- A company connects its calling platform with an API key. A background sync
-- copies the platform's users and call history into the CRM. Platform users
-- are matched to CRM employees by email (or mapped by hand), which is what
-- lets every call be shown on an employee's and a team's analytics.
--
-- Additive and forward-only (tools/migrate.ts).

-- ---------------------------------------------------------------------
-- 1. Module catalog and registry actions (AUTHORIZATION.md §6.4).
-- ---------------------------------------------------------------------
INSERT INTO module (key, name, description) VALUES
('telephony', 'Call Analytics', 'JustCall and Aircall call history with employee and team calling analytics')
ON CONFLICT (key) DO NOTHING;

INSERT INTO registry_action (
  action, module, resource, domain, sensitive, approval_bearing, initiator_field,
  position_grantable, delegation_allowed, super_admin_only, description
) VALUES
  ('telephony:view', 'telephony', 'telephonyCall', 'business', false, false, NULL, true, true, false,
   'See synced calls and calling analytics within the position scope.'),
  ('telephony:listen', 'telephony', 'telephonyCall', 'business', true, false, NULL, true, false, false,
   'Play call recordings and voicemails within the position scope. Every play is audited.'),
  ('telephony:manage', 'telephony', NULL, 'business', true, false, NULL, true, false, true,
   'Connect JustCall or Aircall, map platform users to employees and run syncs.')
ON CONFLICT (action) DO NOTHING;

-- ---------------------------------------------------------------------
-- 2. Connections. One per platform per company. Credentials are an AES-GCM
--    envelope bound to (organization, connection, provider); the plaintext
--    key never reaches the database. Disconnecting wipes the credentials and
--    keeps the synced history.
-- ---------------------------------------------------------------------
CREATE TABLE telephony_connection (
  id                      uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id         uuid NOT NULL REFERENCES organization(id),
  provider                text NOT NULL CHECK (provider IN ('justcall', 'aircall')),
  label                   text NOT NULL CHECK (btrim(label) <> '' AND length(label) <= 120),
  status                  text NOT NULL DEFAULT 'active'
                            CHECK (status IN ('active', 'paused', 'error', 'disconnected')),
  credentials_encrypted   text,
  -- The last four characters of the key, so an admin can tell keys apart.
  credentials_hint        text,
  backfill_days           integer NOT NULL DEFAULT 30 CHECK (backfill_days BETWEEN 1 AND 365),
  -- High-water mark: the start time of the newest call stored so far.
  synced_through          timestamptz,
  last_sync_status        text CHECK (last_sync_status IN ('running', 'succeeded', 'partial', 'failed')),
  last_sync_started_at    timestamptz,
  last_sync_finished_at   timestamptz,
  last_sync_error         text,
  last_verified_at        timestamptz,
  created_by              uuid NOT NULL,
  updated_by              uuid,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, provider),
  CHECK (status = 'disconnected' OR credentials_encrypted IS NOT NULL),
  FOREIGN KEY (organization_id, created_by) REFERENCES app_user (organization_id, id),
  FOREIGN KEY (organization_id, updated_by) REFERENCES app_user (organization_id, id)
);
CREATE TRIGGER telephony_connection_updated_at BEFORE UPDATE ON telephony_connection
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
SELECT apply_tenant_rls('telephony_connection');
REVOKE DELETE ON telephony_connection FROM tapcrm_app;

-- ---------------------------------------------------------------------
-- 3. Platform users (JustCall agents, Aircall users) and their CRM employee.
--    'manual' (mapped by an admin) and 'ignored' (an admin said this user is
--    not an employee, e.g. a shared line) are decisions the email matcher
--    never overrides.
-- ---------------------------------------------------------------------
CREATE TABLE telephony_agent (
  id                uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id   uuid NOT NULL REFERENCES organization(id),
  connection_id     uuid NOT NULL,
  provider          text NOT NULL CHECK (provider IN ('justcall', 'aircall')),
  external_id       text NOT NULL CHECK (btrim(external_id) <> ''),
  name              text,
  email             citext,
  role              text,
  extension         text,
  time_zone         text,
  phone_numbers     text[] NOT NULL DEFAULT '{}',
  provider_groups   text[] NOT NULL DEFAULT '{}',
  metadata          jsonb NOT NULL DEFAULT '{}',
  is_active         boolean NOT NULL DEFAULT true,
  employee_id       uuid,
  match_method      text NOT NULL DEFAULT 'none'
                      CHECK (match_method IN ('none', 'email', 'manual', 'ignored')),
  matched_at        timestamptz,
  matched_by        uuid,
  first_seen_at     timestamptz NOT NULL DEFAULT now(),
  last_seen_at      timestamptz NOT NULL DEFAULT now(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, connection_id, external_id),
  CHECK ((match_method IN ('none', 'ignored')) = (employee_id IS NULL)),
  FOREIGN KEY (organization_id, connection_id) REFERENCES telephony_connection (organization_id, id),
  FOREIGN KEY (organization_id, employee_id) REFERENCES app_user (organization_id, id),
  FOREIGN KEY (organization_id, matched_by) REFERENCES app_user (organization_id, id)
);
CREATE INDEX ix_telephony_agent_employee ON telephony_agent (organization_id, employee_id)
  WHERE employee_id IS NOT NULL;
CREATE INDEX ix_telephony_agent_email ON telephony_agent (organization_id, email)
  WHERE email IS NOT NULL;
CREATE TRIGGER telephony_agent_updated_at BEFORE UPDATE ON telephony_agent
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
SELECT apply_tenant_rls('telephony_agent');
REVOKE DELETE ON telephony_agent FROM tapcrm_app;

-- ---------------------------------------------------------------------
-- 4. Calls. Upserted by (connection, external_id) so a re-sync updates notes,
--    dispositions, recordings and AI results that arrive after the call.
--    Recording URLs are not stored: they expire, and playback fetches a fresh
--    one through the CRM so every play is authorized and audited.
-- ---------------------------------------------------------------------
CREATE TABLE telephony_call (
  id                    uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id       uuid NOT NULL REFERENCES organization(id),
  connection_id         uuid NOT NULL,
  provider              text NOT NULL CHECK (provider IN ('justcall', 'aircall')),
  external_id           text NOT NULL CHECK (btrim(external_id) <> ''),
  agent_id              uuid,
  direction             text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  outcome               text NOT NULL
                          CHECK (outcome IN ('answered', 'missed', 'voicemail', 'abandoned',
                                             'unanswered', 'busy', 'failed', 'other')),
  provider_status       text,
  missed_reason         text,
  started_at            timestamptz NOT NULL,
  answered_at           timestamptz,
  ended_at              timestamptz,
  duration_seconds      integer NOT NULL DEFAULT 0 CHECK (duration_seconds >= 0),
  talk_seconds          integer NOT NULL DEFAULT 0 CHECK (talk_seconds >= 0),
  ring_seconds          integer CHECK (ring_seconds >= 0),
  hold_seconds          integer CHECK (hold_seconds >= 0),
  queue_wait_seconds    integer CHECK (queue_wait_seconds >= 0),
  wrap_up_seconds       integer CHECK (wrap_up_seconds >= 0),
  contact_number        text,
  contact_name          text,
  contact_email         text,
  business_number       text,
  business_number_name  text,
  has_recording         boolean NOT NULL DEFAULT false,
  has_voicemail         boolean NOT NULL DEFAULT false,
  notes                 text,
  disposition           text,
  tags                  text[] NOT NULL DEFAULT '{}',
  rating                integer,
  ai_summary            text,
  ai_sentiment          text,
  ai_score              numeric(6, 2),
  provider_link         text,
  metadata              jsonb NOT NULL DEFAULT '{}',
  first_synced_at       timestamptz NOT NULL DEFAULT now(),
  last_synced_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, connection_id, external_id),
  FOREIGN KEY (organization_id, connection_id) REFERENCES telephony_connection (organization_id, id),
  FOREIGN KEY (organization_id, agent_id) REFERENCES telephony_agent (organization_id, id)
);
CREATE INDEX ix_telephony_call_started ON telephony_call (organization_id, started_at DESC);
CREATE INDEX ix_telephony_call_agent_started ON telephony_call (organization_id, agent_id, started_at DESC);
CREATE INDEX ix_telephony_call_contact ON telephony_call (organization_id, contact_number)
  WHERE contact_number IS NOT NULL;
SELECT apply_tenant_rls('telephony_call');
REVOKE DELETE ON telephony_call FROM tapcrm_app;

-- ---------------------------------------------------------------------
-- 5. Sync runs: one row per attempt, so an admin can see what each sync did
--    and why one failed.
-- ---------------------------------------------------------------------
CREATE TABLE telephony_sync_run (
  id                uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id   uuid NOT NULL REFERENCES organization(id),
  connection_id     uuid NOT NULL,
  trigger           text NOT NULL CHECK (trigger IN ('connect', 'manual', 'schedule')),
  status            text NOT NULL DEFAULT 'running'
                      CHECK (status IN ('running', 'succeeded', 'partial', 'failed')),
  window_from       timestamptz,
  window_to         timestamptz,
  agents_seen       integer NOT NULL DEFAULT 0,
  agents_matched    integer NOT NULL DEFAULT 0,
  calls_seen        integer NOT NULL DEFAULT 0,
  calls_created     integer NOT NULL DEFAULT 0,
  calls_updated     integer NOT NULL DEFAULT 0,
  api_requests      integer NOT NULL DEFAULT 0,
  error             text,
  requested_by      uuid,
  started_at        timestamptz NOT NULL DEFAULT now(),
  finished_at       timestamptz,
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, connection_id) REFERENCES telephony_connection (organization_id, id),
  FOREIGN KEY (organization_id, requested_by) REFERENCES app_user (organization_id, id)
);
CREATE INDEX ix_telephony_sync_run_connection ON telephony_sync_run (organization_id, connection_id, started_at DESC);
SELECT apply_tenant_rls('telephony_sync_run');
REVOKE DELETE ON telephony_sync_run FROM tapcrm_app;

-- ---------------------------------------------------------------------
-- 6. Companies that already sell get Call Analytics with their Sales
--    modules, and the seeded Sales positions get the same reach they have on
--    callbacks (policy-matrix.ts). telephony:manage stays with Super Admin.
-- ---------------------------------------------------------------------
INSERT INTO organization_module (organization_id, module_id, status, enabled_at)
SELECT om.organization_id, telephony.id, 'enabled', now()
FROM organization_module om
JOIN module leads ON leads.id = om.module_id AND leads.key = 'leads'
CROSS JOIN module telephony
WHERE telephony.key = 'telephony'
  AND om.status = 'enabled'
ON CONFLICT (organization_id, module_id) DO NOTHING;

INSERT INTO position_policy (organization_id, position_id, action, allowed, scope)
SELECT p.organization_id, p.id, actions.action, true, defaults.scope
FROM position p
JOIN (VALUES
  ('sales-head', 'department'),
  ('sales-team-lead', 'team'),
  ('sales-supervisor', 'pool'),
  ('sales-agent', 'own')
) AS defaults(code, scope) ON defaults.code = p.code
CROSS JOIN (VALUES ('telephony:view'), ('telephony:listen')) AS actions(action)
WHERE p.is_seeded = true
  AND p.status = 'active'
  AND EXISTS (
    SELECT 1 FROM organization_module om
    JOIN module m ON m.id = om.module_id
    WHERE om.organization_id = p.organization_id AND m.key = 'telephony' AND om.status = 'enabled'
  )
ON CONFLICT (organization_id, position_id, action) DO NOTHING;
