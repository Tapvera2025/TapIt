-- =====================================================================
-- 0145 — Client meetings
--
-- Clients ask for a meeting with someone on their project from the portal.
-- That person accepts, offers other times, or declines; staff can also book a
-- meeting with a client directly. A confirmed meeting gets a Google Calendar
-- event with a Meet link when the host's Google Calendar is connected (or the
-- company runs Google Workspace delegation), and a pasted link otherwise.
-- Managers see who is meeting whom and every request's history.
--
-- Additive and forward-only (tools/migrate.ts).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Module catalog and registry actions (AUTHORIZATION.md §6.4).
--    meetings:host  meet clients. The scope reaches whose meetings the
--                   holder may answer, move or cancel: `own` is their own;
--                   a manager's team or department covers their people's.
--    meetings:view  the tracking board: who is meeting whom, and what was
--                   requested, declined, moved or cancelled.
--    meetings:join  join a meeting one was not invited to (every use is
--                   audited, so it is never delegable).
-- ---------------------------------------------------------------------
INSERT INTO module (key, name, description) VALUES
('meetings', 'Client meetings', 'Clients request meetings with the people on their projects, staff book Google Meet calls, and managers see who is meeting whom')
ON CONFLICT (key) DO NOTHING;

INSERT INTO registry_action (
  action, module, resource, domain, sensitive, approval_bearing, initiator_field,
  position_grantable, delegation_allowed, super_admin_only, description
) VALUES
  ('meetings:host', 'meetings', 'meeting', 'business', false, false, NULL, true, true, false,
   'Meet clients: be offered to the clients of your projects, answer their meeting requests and book meetings.'),
  ('meetings:view', 'meetings', 'meeting', 'business', false, false, NULL, true, true, false,
   'See client meetings and requests: who is meeting whom, and which were declined, moved or cancelled.'),
  ('meetings:join', 'meetings', 'meeting', 'business', true, false, NULL, true, false, false,
   'Join a client meeting you were not invited to.')
ON CONFLICT (action) DO NOTHING;

-- ---------------------------------------------------------------------
-- 2. Meetings. `starts_at`/`ends_at` hold the requested time until the host
--    answers, then the agreed time. The calendar columns name the Google
--    event on the host's calendar, when there is one.
-- ---------------------------------------------------------------------
CREATE TABLE meeting (
  id                uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id   uuid NOT NULL REFERENCES organization(id),
  title             text NOT NULL CHECK (btrim(title) <> '' AND length(title) <= 200),
  agenda            text CHECK (agenda IS NULL OR length(agenda) <= 2000),
  status            text NOT NULL CHECK (status IN (
                      'requested', 'proposed', 'confirmed', 'declined',
                      'cancelled', 'expired', 'completed', 'no_show')),
  origin            text NOT NULL CHECK (origin IN ('client', 'staff')),
  host_id           uuid NOT NULL,
  client_id         uuid,
  project_id        uuid,
  requested_by      uuid NOT NULL,
  starts_at         timestamptz NOT NULL,
  ends_at           timestamptz NOT NULL,
  client_timezone   text,
  meet_url          text CHECK (meet_url IS NULL OR (meet_url ~ '^https://' AND length(meet_url) <= 500)),
  calendar_event_id text,
  calendar_owner_id uuid,
  calendar_error    text,
  responded_at      timestamptz,
  confirmed_at      timestamptz,
  decline_reason    text CHECK (decline_reason IS NULL OR length(decline_reason) <= 500),
  cancel_reason     text CHECK (cancel_reason IS NULL OR length(cancel_reason) <= 500),
  cancelled_by      uuid,
  outcome_note      text CHECK (outcome_note IS NULL OR length(outcome_note) <= 2000),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, host_id) REFERENCES app_user (organization_id, id),
  FOREIGN KEY (organization_id, requested_by) REFERENCES app_user (organization_id, id),
  FOREIGN KEY (organization_id, cancelled_by) REFERENCES app_user (organization_id, id),
  FOREIGN KEY (organization_id, calendar_owner_id) REFERENCES app_user (organization_id, id),
  FOREIGN KEY (organization_id, client_id) REFERENCES client (organization_id, id),
  FOREIGN KEY (organization_id, project_id) REFERENCES project (organization_id, id)
);
CREATE INDEX ix_meeting_host_time ON meeting (organization_id, host_id, starts_at);
CREATE INDEX ix_meeting_status_time ON meeting (organization_id, status, starts_at);
CREATE INDEX ix_meeting_client ON meeting (organization_id, client_id, starts_at);

-- Who is in the meeting. Staff are users; client contacts are an email, and
-- also a user when they have a portal login.
CREATE TABLE meeting_attendee (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL REFERENCES organization(id),
  meeting_id      uuid NOT NULL,
  user_id         uuid,
  email           citext,
  display_name    text CHECK (display_name IS NULL OR length(display_name) <= 200),
  role            text NOT NULL CHECK (role IN ('host', 'staff', 'client', 'observer')),
  added_by        uuid,
  added_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (user_id IS NOT NULL OR email IS NOT NULL),
  FOREIGN KEY (organization_id, meeting_id) REFERENCES meeting (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, user_id) REFERENCES app_user (organization_id, id)
);
CREATE UNIQUE INDEX ux_meeting_attendee_user ON meeting_attendee (organization_id, meeting_id, user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX ux_meeting_attendee_email ON meeting_attendee (organization_id, meeting_id, email) WHERE user_id IS NULL;
CREATE INDEX ix_meeting_attendee_user ON meeting_attendee (organization_id, user_id) WHERE user_id IS NOT NULL;

-- Other times the host offered. The client picks one; the rest are withdrawn.
CREATE TABLE meeting_proposal (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL REFERENCES organization(id),
  meeting_id      uuid NOT NULL,
  starts_at       timestamptz NOT NULL,
  ends_at         timestamptz NOT NULL,
  proposed_by     uuid NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  chosen_at       timestamptz,
  withdrawn_at    timestamptz,
  CHECK (ends_at > starts_at),
  FOREIGN KEY (organization_id, meeting_id) REFERENCES meeting (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, proposed_by) REFERENCES app_user (organization_id, id)
);
CREATE INDEX ix_meeting_proposal_meeting ON meeting_proposal (organization_id, meeting_id);

-- Every step of a meeting, for its history and the tracking board.
CREATE TABLE meeting_event (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL REFERENCES organization(id),
  meeting_id      uuid NOT NULL,
  event           text NOT NULL CHECK (event IN (
                    'requested', 'scheduled', 'accepted', 'proposed', 'chosen', 'declined',
                    'cancelled', 'expired', 'completed', 'no_show', 'joined', 'reminded',
                    'escalated', 'link_added', 'calendar_failed')),
  actor_id        uuid,
  actor_kind      text NOT NULL CHECK (actor_kind IN ('client', 'staff', 'system')),
  detail          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, meeting_id) REFERENCES meeting (organization_id, id) ON DELETE CASCADE
);
CREATE INDEX ix_meeting_event_meeting ON meeting_event (organization_id, meeting_id, created_at);

-- Reminders already sent, so each goes out once.
CREATE TABLE meeting_reminder (
  organization_id uuid NOT NULL REFERENCES organization(id),
  meeting_id      uuid NOT NULL,
  kind            text NOT NULL CHECK (kind IN (
                    'client_24h', 'client_1h', 'staff_soon', 'host_nudge', 'escalation', 'outcome')),
  sent_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, meeting_id, kind),
  FOREIGN KEY (organization_id, meeting_id) REFERENCES meeting (organization_id, id) ON DELETE CASCADE
);

-- ---------------------------------------------------------------------
-- 3. Google Calendar connections, one per person. The refresh token is
--    encrypted with MEETINGS_TOKEN_ENCRYPTION_KEY; with Workspace delegation
--    (MEETINGS_GOOGLE_AUTH=service-account) nobody needs a row here.
-- ---------------------------------------------------------------------
CREATE TABLE calendar_connection (
  id                    uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id       uuid NOT NULL REFERENCES organization(id),
  user_id               uuid NOT NULL,
  provider              text NOT NULL CHECK (provider IN ('google')),
  account_email         citext,
  credentials_encrypted text NOT NULL,
  scopes                text[] NOT NULL DEFAULT '{}',
  status                text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'needs_reconnect')),
  last_error            text,
  connected_at          timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, user_id),
  FOREIGN KEY (organization_id, user_id) REFERENCES app_user (organization_id, id) ON DELETE CASCADE
);

-- A Google sign-in in progress: single use, ten minutes.
CREATE TABLE calendar_oauth_state (
  organization_id uuid NOT NULL REFERENCES organization(id),
  state_hash      text NOT NULL,
  user_id         uuid NOT NULL,
  expires_at      timestamptz NOT NULL,
  consumed_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, state_hash),
  FOREIGN KEY (organization_id, user_id) REFERENCES app_user (organization_id, id) ON DELETE CASCADE
);

SELECT apply_tenant_rls('meeting');
SELECT apply_tenant_rls('meeting_attendee');
SELECT apply_tenant_rls('meeting_proposal');
SELECT apply_tenant_rls('meeting_event');
SELECT apply_tenant_rls('meeting_reminder');
SELECT apply_tenant_rls('calendar_connection');
SELECT apply_tenant_rls('calendar_oauth_state');

CREATE TRIGGER trg_meeting_updated BEFORE UPDATE ON meeting FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_calendar_connection_updated BEFORE UPDATE ON calendar_connection FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------
-- 4. Companies with projects or the client portal get Client meetings, with
--    the starter defaults (policy-matrix.ts `meetings`): managers meet clients
--    and oversee their people's meetings; anyone else is granted it by a
--    Super Admin from Access Management.
-- ---------------------------------------------------------------------
INSERT INTO organization_module (organization_id, module_id, status, enabled_at)
SELECT DISTINCT om.organization_id, meetings.id, 'enabled', now()
FROM organization_module om
JOIN module m ON m.id = om.module_id AND m.key IN ('projects', 'client-portal')
CROSS JOIN module meetings
WHERE meetings.key = 'meetings'
  AND om.status = 'enabled'
ON CONFLICT (organization_id, module_id) DO NOTHING;

INSERT INTO position_policy (organization_id, position_id, action, allowed, scope)
SELECT p.organization_id, p.id, actions.action, true, defaults.scope
FROM position p
JOIN (VALUES
  ('sales-head', 'department'),
  ('dev-dept-head', 'department'),
  ('project-manager', 'own'),
  ('sales-team-lead', 'team'),
  ('developer-team-manager', 'team'),
  ('content-team-manager', 'team'),
  ('digital-marketing-manager', 'team'),
  ('sales-supervisor', 'pool')
) AS defaults(code, scope) ON defaults.code = p.code
CROSS JOIN (VALUES ('meetings:host'), ('meetings:view'), ('meetings:join')) AS actions(action)
WHERE p.is_seeded = true
  AND p.status = 'active'
  AND EXISTS (
    SELECT 1 FROM organization_module om
    JOIN module m ON m.id = om.module_id
    WHERE om.organization_id = p.organization_id AND m.key = 'meetings' AND om.status = 'enabled'
  )
ON CONFLICT (organization_id, position_id, action) DO NOTHING;
