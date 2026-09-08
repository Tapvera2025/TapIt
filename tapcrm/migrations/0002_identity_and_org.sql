-- =====================================================================
-- 0002 — Identity and Organization (P0 Foundation)
--
-- Tables from TECH.md §5.3 groups "Identity" and "Org".
-- Indexes are verbatim from TECH.md §5.5 where given.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Departments
-- D-1: code is immutable. D-2: a department in use is deactivated, not deleted.
-- ---------------------------------------------------------------------
CREATE TABLE department (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id  uuid NOT NULL REFERENCES organization(id),
  code             text NOT NULL,
  name             text NOT NULL,
  kind             text NOT NULL CHECK (kind IN ('support', 'delivery')),
  -- D-6: Finance ships inactive. "The department and its two positions exist in
  -- the ladder so that staffing finance later is an ACTIVATION rather than a
  -- schema change."
  status           text NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active', 'inactive')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  -- TN-4: composite key so child FKs can enforce same-tenant relationships.
  UNIQUE (organization_id, id)
);

-- ---------------------------------------------------------------------
-- Positions — "the unit of authority" (PRD glossary)
-- ---------------------------------------------------------------------
CREATE TABLE position (
  id                    uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id       uuid NOT NULL REFERENCES organization(id),
  department_id         uuid NOT NULL,
  code                  text NOT NULL,
  name                  text NOT NULL,
  -- PRD §4.3: "an organizational attribute used by delegation and approval
  -- policy. IT IS NOT AN AUTHORIZATION GRANT." Never consulted when deciding
  -- whether a user may read a record.
  organizational_level  integer NOT NULL CHECK (organizational_level BETWEEN 1 AND 100),
  -- C-2: every custom position has a parent. Only Super Admin is parentless,
  -- and Super Admin is not a Position (§2.1).
  parent_position_id    uuid,
  is_seeded             boolean NOT NULL DEFAULT false,
  status                text NOT NULL DEFAULT 'active'
                          CHECK (status IN ('active', 'inactive')),
  -- SA-1: approval thresholds are configured per position.
  max_deal_value        numeric(18, 2),
  max_discount_percent  numeric(5, 2) CHECK (max_discount_percent BETWEEN 0 AND 100),
  allows_custom_terms   boolean NOT NULL DEFAULT false,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, department_id) REFERENCES department (organization_id, id),
  FOREIGN KEY (organization_id, parent_position_id) REFERENCES position (organization_id, id),
  -- R-4 / C-1: a position cannot be its own parent.
  CHECK (id <> parent_position_id)
);

-- ---------------------------------------------------------------------
-- Teams — "the organizational unit that bounds lateral visibility" (§3.5)
-- ---------------------------------------------------------------------
CREATE TABLE team (
  id                 uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id    uuid NOT NULL REFERENCES organization(id),
  department_id      uuid NOT NULL,
  kind               text NOT NULL
                       CHECK (kind IN ('sales-team', 'sales-pool', 'dev-subteam')),
  name               text NOT NULL,
  lead_user_id       uuid,
  -- T-1: a pool's parent is its Team Lead's sales-team. NULL otherwise.
  -- The recursive team CTE descends ONLY through this column and never ascends,
  -- which is how protected constraint P6 holds structurally.
  parent_team_id     uuid,
  shared_visibility  boolean NOT NULL DEFAULT false,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, department_id) REFERENCES department (organization_id, id),
  FOREIGN KEY (organization_id, parent_team_id) REFERENCES team (organization_id, id),
  CHECK (id <> parent_team_id),
  -- T-2: dev sub-teams do not nest.
  CHECK (kind <> 'dev-subteam' OR parent_team_id IS NULL),
  -- T-1: only a pool has a parent.
  CHECK (kind <> 'sales-team' OR parent_team_id IS NULL)
);

CREATE TABLE designation (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id  uuid NOT NULL REFERENCES organization(id),
  name             text NOT NULL,
  -- P-2: specializations are configuration; adding one needs no deployment.
  specializations  text[] NOT NULL DEFAULT '{}',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id)
);

-- ---------------------------------------------------------------------
-- Users
-- ED-4 / SD-7: "A user without a position CANNOT BE CREATED. The loader has no
-- bypass." Enforced by NOT NULL on position_id for employees.
-- ---------------------------------------------------------------------
CREATE TABLE app_user (
  id                   uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id      uuid NOT NULL REFERENCES organization(id),
  -- PRD §2: exactly one of four account types.
  account_type         text NOT NULL
                         CHECK (account_type IN ('super-admin', 'employee', 'client', 'service')),
  -- ID-1: employee and client emails are INDEPENDENT NAMESPACES and an
  -- address may exist in both. Uniqueness is therefore per (org, type, email),
  -- not per address. citext makes the comparison case-insensitive without a
  -- functional index every query has to remember to match.
  email                citext,
  password_hash        text,
  status               text NOT NULL DEFAULT 'active'
                         CHECK (status IN ('active', 'inactive', 'locked', 'offboarded')),
  -- ID-7: incremented by deactivation, password change, role change or
  -- revocation; invalidates all sessions within 60 seconds.
  session_version      integer NOT NULL DEFAULT 1,
  email_verified_at    timestamptz,
  mfa_required         boolean NOT NULL DEFAULT false,

  -- Employee-only attributes.
  position_id          uuid,
  department_id        uuid,
  team_id              uuid,
  designation_id       uuid,
  specialization       text,
  -- R-1: must reference a user whose position is an ancestor within the same
  -- department, or Super Admin. R-4: no cycles. Both enforced in application
  -- validation; the FK below only guarantees the reference is a real user.
  reports_to           uuid,

  -- Client-only attribute. A2 evaluates against this before policy resolution.
  client_id            uuid,

  full_name            text NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),

  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, position_id)   REFERENCES position (organization_id, id),
  FOREIGN KEY (organization_id, department_id) REFERENCES department (organization_id, id),
  FOREIGN KEY (organization_id, team_id)       REFERENCES team (organization_id, id),
  FOREIGN KEY (organization_id, reports_to)    REFERENCES app_user (organization_id, id),
  CHECK (id <> reports_to),

  -- ED-4: an employee always holds a position.
  CHECK (account_type <> 'employee' OR (position_id IS NOT NULL AND department_id IS NOT NULL)),
  -- §2.1: Super Admin "is not modelled as a Position, does not appear in the
  -- reporting chain, and is not assignable to a department."
  CHECK (account_type <> 'super-admin' OR (position_id IS NULL AND department_id IS NULL)),
  -- §2.2 SV-1: "A service account never inherits a Position policy and can
  -- never be assigned one. The two models do not mix."
  CHECK (account_type <> 'service' OR position_id IS NULL),
  -- A client "never holds a Position" and always belongs to an account.
  CHECK (account_type <> 'client' OR (client_id IS NOT NULL AND position_id IS NULL))
);

-- ---------------------------------------------------------------------
-- Permission policies — PRD §4.1
-- "A Position does not carry a single scope. It carries a LIST of permission
--  policies, one per action, each with its own reach."
-- ---------------------------------------------------------------------
CREATE TABLE position_policy (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id  uuid NOT NULL REFERENCES organization(id),
  position_id      uuid NOT NULL,
  action           text NOT NULL,
  allowed          boolean NOT NULL DEFAULT true,
  -- PRD §4.1: there is deliberately no 'all'. Organization-wide reach is the
  -- derived globalAccess capability, never a storable value.
  scope            text NOT NULL
                     CHECK (scope IN ('own', 'participant', 'pool', 'team', 'department', 'all-people')),
  fields           text[],
  constraints      text[],
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, position_id) REFERENCES position (organization_id, id)
);

-- ---------------------------------------------------------------------
-- Per-user overrides — PRD §4.4
-- "An override is a FULL POLICY, not a boolean."
-- ---------------------------------------------------------------------
CREATE TABLE user_override (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id  uuid NOT NULL REFERENCES organization(id),
  user_id          uuid NOT NULL,
  action           text NOT NULL,
  allowed          boolean NOT NULL,
  scope            text NOT NULL
                     CHECK (scope IN ('own', 'participant', 'pool', 'team', 'department', 'all-people')),
  fields           text[],
  constraints      text[],
  -- AM-6: a required reason. An undocumented exception is an exception nobody
  -- can review at renewal time.
  reason           text NOT NULL CHECK (length(trim(reason)) > 0),
  granted_by       uuid NOT NULL,
  granted_at       timestamptz NOT NULL DEFAULT now(),
  -- AZ-I6 / OV-3: expiry is evaluated AT RESOLUTION TIME. Rows with
  -- expires_at <= now() are excluded by the resolution query. The nightly job
  -- only marks, notifies and audits — it is never the decision.
  expires_at       timestamptz,
  revoked_at       timestamptz,
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, user_id)    REFERENCES app_user (organization_id, id),
  FOREIGN KEY (organization_id, granted_by) REFERENCES app_user (organization_id, id)
);

CREATE TABLE role_change_request (
  id                  uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id     uuid NOT NULL REFERENCES organization(id),
  subject_user_id     uuid NOT NULL,
  from_position_id    uuid,
  to_position_id      uuid NOT NULL,
  -- A1 / RG-4: `access:decide-role-change` declares `requestedBy` as its
  -- initiator field. The segregation engine reads exactly this column.
  requested_by        uuid NOT NULL,
  requested_at        timestamptz NOT NULL DEFAULT now(),
  reason              text NOT NULL,
  status              text NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'approved', 'rejected')),
  decided_by          uuid,
  decided_at          timestamptz,
  decision_reason     text,
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, subject_user_id) REFERENCES app_user (organization_id, id),
  FOREIGN KEY (organization_id, requested_by)    REFERENCES app_user (organization_id, id),
  -- A1 at the database layer as well as the engine. Defence in depth: the
  -- engine refuses at step 2, and this refuses if anything ever bypasses it.
  CHECK (decided_by IS NULL OR decided_by <> requested_by)
);

-- ---------------------------------------------------------------------
-- Registry projection — RG-I3
-- "a projection, NEVER EDITED; a row absent from the generated set is removed."
-- Global rather than tenant-owned: the registry is the same for every tenant.
-- ---------------------------------------------------------------------
CREATE TABLE registry_action (
  action              text PRIMARY KEY,
  module              text NOT NULL,
  resource            text,
  domain              text NOT NULL CHECK (domain IN ('people', 'business', 'derived')),
  sensitive           boolean NOT NULL,
  approval_bearing    boolean NOT NULL,
  initiator_field     text,
  position_grantable  boolean NOT NULL,
  delegation_allowed  boolean NOT NULL,
  super_admin_only    boolean NOT NULL,
  description         text NOT NULL DEFAULT '',
  -- RG-4 at the storage layer.
  CHECK (NOT approval_bearing OR initiator_field IS NOT NULL),
  -- RG-3.
  CHECK (position_grantable OR (NOT delegation_allowed AND super_admin_only)),
  -- RG-2.
  CHECK (NOT super_admin_only OR NOT delegation_allowed),
  -- RG-1.
  CHECK (NOT delegation_allowed OR NOT sensitive)
);

-- ---------------------------------------------------------------------
-- Sessions and credentials
-- ---------------------------------------------------------------------
CREATE TABLE session (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id  uuid NOT NULL REFERENCES organization(id),
  user_id          uuid NOT NULL,
  session_version  integer NOT NULL,
  device_label     text,
  ip               inet,
  approx_location  text,
  user_agent       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  last_active_at   timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz NOT NULL,
  revoked_at       timestamptz,
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, user_id) REFERENCES app_user (organization_id, id)
);

CREATE TABLE refresh_token (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id  uuid NOT NULL REFERENCES organization(id),
  session_id       uuid NOT NULL,
  -- The token itself is never stored, only its hash.
  token_hash       text NOT NULL,
  -- ID-6: "Refresh-token reuse detection revokes the whole family and alerts
  -- the user." The family id is what makes a replayed token traceable to every
  -- descendant issued from it.
  family_id        uuid NOT NULL,
  parent_id        uuid,
  used_at          timestamptz,
  expires_at       timestamptz NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, token_hash),
  FOREIGN KEY (organization_id, session_id) REFERENCES session (organization_id, id)
);

CREATE TABLE mfa_enrollment (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id  uuid NOT NULL REFERENCES organization(id),
  user_id          uuid NOT NULL,
  -- ID-5: second factors carry an ASSURANCE LEVEL and are not interchangeable.
  -- ID-5a: "an OTP delivered to a compromised mailbox is not a second factor,
  -- it is the same factor twice."
  method           text NOT NULL CHECK (method IN ('passkey', 'totp', 'email-otp')),
  assurance        text NOT NULL CHECK (assurance IN ('high', 'low')),
  secret_ref       text NOT NULL,
  label            text,
  enrolled_at      timestamptz NOT NULL DEFAULT now(),
  last_used_at     timestamptz,
  revoked_at       timestamptz,
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, user_id) REFERENCES app_user (organization_id, id),
  -- ID-5/ID-5a encoded: email OTP is always low assurance, and a privileged
  -- position may not satisfy ID-4 with it.
  CHECK ((method = 'email-otp') = (assurance = 'low'))
);

CREATE TABLE service_account (
  id                 uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id    uuid NOT NULL REFERENCES organization(id),
  name               text NOT NULL,
  description        text,
  -- SV-2: explicit list, no wildcards — "a wildcard silently acquires every
  -- action added later."
  allowed_actions    text[] NOT NULL,
  allowed_resources  text[] NOT NULL,
  -- SV-2b: tenancy is NOT part of record_filter. organization_id above is the
  -- boundary, injected by the DAL before any narrowing filter is applied.
  record_filter      jsonb,
  ip_allowlist       inet[],
  -- SV-3: mandatory expiry, maximum 365 days. "An unexpiring credential is a
  -- permanent unowned key."
  expires_at         timestamptz NOT NULL,
  rate_limit_minute  integer NOT NULL DEFAULT 60,
  rate_limit_day     integer NOT NULL DEFAULT 10000,
  credential_hash    text NOT NULL,
  created_by         uuid NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  last_used_at       timestamptz,
  disabled_at        timestamptz,
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, created_by) REFERENCES app_user (organization_id, id),
  CHECK (cardinality(allowed_actions) > 0),
  CHECK (expires_at <= created_at + interval '365 days')
);

-- ---------------------------------------------------------------------
-- Geofencing — ID-13..ID-18b
-- ---------------------------------------------------------------------
CREATE TABLE geofence_location (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id  uuid NOT NULL REFERENCES organization(id),
  name             text NOT NULL,
  latitude         numeric(9, 6) NOT NULL,
  longitude        numeric(9, 6) NOT NULL,
  radius_metres    integer NOT NULL CHECK (radius_metres > 0),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id)
);

CREATE TABLE geofence_assignment (
  organization_id  uuid NOT NULL REFERENCES organization(id),
  user_id          uuid NOT NULL,
  location_id      uuid NOT NULL,
  -- ID-18: a temporary bypass has a mandatory expiry of at most 7 days.
  bypass_until     timestamptz,
  bypass_reason    text,
  PRIMARY KEY (organization_id, user_id, location_id),
  FOREIGN KEY (organization_id, user_id)     REFERENCES app_user (organization_id, id),
  FOREIGN KEY (organization_id, location_id) REFERENCES geofence_location (organization_id, id),
  CHECK (bypass_until IS NULL OR bypass_reason IS NOT NULL)
);

CREATE TABLE geofence_event (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id  uuid NOT NULL REFERENCES organization(id),
  user_id          uuid NOT NULL,
  occurred_at      timestamptz NOT NULL DEFAULT now(),
  allowed          boolean NOT NULL,
  -- ID-15a: coordinates are retained for 90 days then deleted; the DERIVED
  -- decision (allowed/denied with distance band) is retained for the audit
  -- period. Two different retention clocks, so two different columns.
  latitude         numeric(9, 6),
  longitude        numeric(9, 6),
  accuracy_metres  integer,
  distance_band    text,
  nearest_location_id uuid,
  coordinates_purge_at timestamptz NOT NULL DEFAULT (now() + interval '90 days'),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, user_id) REFERENCES app_user (organization_id, id)
);

COMMENT ON COLUMN geofence_event.coordinates_purge_at IS
  'DP-3 / ID-15a. Coordinates are used SOLELY for the access decision and its audit — never for productivity measurement, never for locating an employee outside a login event.';

-- ---------------------------------------------------------------------
-- RLS on every tenant-owned table (TN-2, PG-4)
-- ---------------------------------------------------------------------
SELECT apply_tenant_rls('department');
SELECT apply_tenant_rls('position');
SELECT apply_tenant_rls('team');
SELECT apply_tenant_rls('designation');
SELECT apply_tenant_rls('app_user');
SELECT apply_tenant_rls('position_policy');
SELECT apply_tenant_rls('user_override');
SELECT apply_tenant_rls('role_change_request');
SELECT apply_tenant_rls('session');
SELECT apply_tenant_rls('refresh_token');
SELECT apply_tenant_rls('mfa_enrollment');
SELECT apply_tenant_rls('service_account');
SELECT apply_tenant_rls('geofence_location');
SELECT apply_tenant_rls('geofence_assignment');
SELECT apply_tenant_rls('geofence_event');

-- registry_action is global reference data (TN-3): the same 147 rows for every
-- tenant. It is read-only to the application (RG-I3: never edited).
GRANT SELECT ON registry_action TO tapcrm_app;
REVOKE INSERT, UPDATE, DELETE ON registry_action FROM tapcrm_app;

-- ---------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------
CREATE TRIGGER trg_department_updated  BEFORE UPDATE ON department
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_position_updated    BEFORE UPDATE ON position
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_team_updated        BEFORE UPDATE ON team
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_app_user_updated    BEFORE UPDATE ON app_user
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_position_policy_updated BEFORE UPDATE ON position_policy
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------
-- Indexes — TECH.md §5.5, verbatim where the document gives them.
-- IX-1: tenant-scoped indexes lead with organization_id.
-- IX-2: every tenant-scoped unique constraint includes organization_id.
-- ---------------------------------------------------------------------
-- ID-1: an address may exist once as an employee and once as a client.
CREATE UNIQUE INDEX ux_user_org_email      ON app_user (organization_id, account_type, email)
  WHERE email IS NOT NULL;
CREATE INDEX ix_user_org_department        ON app_user (organization_id, department_id);
CREATE INDEX ix_user_org_team              ON app_user (organization_id, team_id);
CREATE INDEX ix_user_org_reports_to        ON app_user (organization_id, reports_to);

CREATE UNIQUE INDEX ux_position_org_code   ON position (organization_id, code);
CREATE UNIQUE INDEX ux_position_policy     ON position_policy (organization_id, position_id, action);
-- Partial (IX-5): only live overrides are ever resolved, and the predicate is
-- stable. AZ-I6 excludes expired rows at resolution time via this index.
CREATE UNIQUE INDEX ux_user_override       ON user_override (organization_id, user_id, action)
  WHERE revoked_at IS NULL;

CREATE UNIQUE INDEX ux_department_org_code ON department (organization_id, code);
CREATE INDEX ix_team_org_parent            ON team (organization_id, parent_team_id);
CREATE INDEX ix_team_org_department        ON team (organization_id, department_id);

CREATE INDEX ix_session_org_user           ON session (organization_id, user_id)
  WHERE revoked_at IS NULL;
CREATE INDEX ix_refresh_family             ON refresh_token (organization_id, family_id);
CREATE INDEX ix_geofence_event_user        ON geofence_event (organization_id, user_id, occurred_at DESC);
-- Drives the ID-15a 90-day coordinate purge.
CREATE INDEX ix_geofence_event_purge       ON geofence_event (coordinates_purge_at)
  WHERE latitude IS NOT NULL;
