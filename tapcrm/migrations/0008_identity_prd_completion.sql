-- =====================================================================
-- 0008 — Identity PRD completion: passkeys, security telemetry,
-- geofence appeals/config alerts, WFH, service credential metadata.
-- =====================================================================

CREATE TABLE IF NOT EXISTS webauthn_challenge (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL REFERENCES organization(id),
  user_id uuid NOT NULL REFERENCES app_user(id),
  challenge text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('registration','authentication')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, user_id, kind)
);

CREATE TABLE IF NOT EXISTS passkey_credential (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL REFERENCES organization(id),
  user_id uuid NOT NULL,
  credential_id text NOT NULL,
  public_key text NOT NULL,
  counter bigint NOT NULL DEFAULT 0,
  transports text[],
  device_type text,
  backed_up boolean NOT NULL DEFAULT false,
  label text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, credential_id),
  FOREIGN KEY (organization_id,user_id) REFERENCES app_user(organization_id,id)
);

CREATE TABLE IF NOT EXISTS login_security_event (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL REFERENCES organization(id),
  user_id uuid,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  ip inet,
  user_agent text,
  country_code text,
  latitude numeric(9,6),
  longitude numeric(9,6),
  suspicious boolean NOT NULL DEFAULT false,
  reason text,
  UNIQUE (organization_id,id),
  FOREIGN KEY (organization_id,user_id) REFERENCES app_user(organization_id,id)
);

CREATE TABLE IF NOT EXISTS geofence_bypass_request (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL REFERENCES organization(id),
  user_id uuid NOT NULL,
  geofence_event_id uuid,
  reason text NOT NULL,
  accuracy_metres integer,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','expired')),
  requested_until timestamptz NOT NULL,
  decided_by uuid,
  decision_reason text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  UNIQUE (organization_id,id),
  FOREIGN KEY (organization_id,user_id) REFERENCES app_user(organization_id,id),
  FOREIGN KEY (organization_id,geofence_event_id) REFERENCES geofence_event(organization_id,id),
  FOREIGN KEY (organization_id,decided_by) REFERENCES app_user(organization_id,id),
  CHECK (requested_until <= requested_at + interval '7 days')
);

CREATE TABLE IF NOT EXISTS geofence_configuration_alert (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL REFERENCES organization(id),
  location_id uuid,
  window_started_at timestamptz NOT NULL,
  window_ended_at timestamptz NOT NULL,
  denied_users integer NOT NULL,
  denied_events integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz,
  UNIQUE (organization_id,id),
  FOREIGN KEY (organization_id,location_id) REFERENCES geofence_location(organization_id,id)
);

CREATE TABLE IF NOT EXISTS approved_wfh_day (
  organization_id uuid NOT NULL REFERENCES organization(id),
  user_id uuid NOT NULL,
  work_date date NOT NULL,
  approved_by uuid NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id,user_id,work_date),
  FOREIGN KEY (organization_id,user_id) REFERENCES app_user(organization_id,id),
  FOREIGN KEY (organization_id,approved_by) REFERENCES app_user(organization_id,id)
);

ALTER TABLE geofence_event ADD COLUMN IF NOT EXISTS latitude_ciphertext text;
ALTER TABLE geofence_event ADD COLUMN IF NOT EXISTS longitude_ciphertext text;
ALTER TABLE geofence_event ADD COLUMN IF NOT EXISTS coordinate_nonce text;
ALTER TABLE geofence_event ADD COLUMN IF NOT EXISTS latitude_nonce text;
ALTER TABLE geofence_event ADD COLUMN IF NOT EXISTS longitude_nonce text;
ALTER TABLE geofence_event ADD COLUMN IF NOT EXISTS coordinate_key_version integer NOT NULL DEFAULT 1;

ALTER TABLE service_account ADD COLUMN IF NOT EXISTS credential_prefix text;
ALTER TABLE service_account ADD COLUMN IF NOT EXISTS credential_last4 text;

SELECT apply_tenant_rls('webauthn_challenge');
SELECT apply_tenant_rls('passkey_credential');
SELECT apply_tenant_rls('login_security_event');
SELECT apply_tenant_rls('geofence_bypass_request');
SELECT apply_tenant_rls('geofence_configuration_alert');
SELECT apply_tenant_rls('approved_wfh_day');

CREATE INDEX IF NOT EXISTS ix_webauthn_challenge_expiry ON webauthn_challenge(organization_id,expires_at);
CREATE INDEX IF NOT EXISTS ix_passkey_user ON passkey_credential(organization_id,user_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_login_security_user_time ON login_security_event(organization_id,user_id,occurred_at DESC);
CREATE INDEX IF NOT EXISTS ix_geofence_bypass_pending ON geofence_bypass_request(organization_id,status,requested_at DESC);
CREATE INDEX IF NOT EXISTS ix_geofence_event_denials ON geofence_event(organization_id,allowed,occurred_at DESC);
CREATE INDEX IF NOT EXISTS ix_wfh_day ON approved_wfh_day(organization_id,user_id,work_date);
