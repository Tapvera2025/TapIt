-- =====================================================================
-- 0050 — Notifications (X5)
--
-- PRD §14.5 NT-1..NT-8, TECH.md §3.1 (transactional outbox), RT-4/RT-5.
--
-- Three tables:
--   notification_outbox    INTENT, written inside the caller's business
--                          transaction (TX-2: no I/O in a transaction). The
--                          dispatcher resolves the audience and fans out.
--   notification           one row PER RECIPIENT. Source of truth for the
--                          notification centre and the unread badge. Sockets
--                          are only a "refetch now" signal on top of this.
--   notification_delivery  one row per notification and channel, recording
--                          status and timestamp (NT-4). Outlives the
--                          notification (NT-8), so no FK to it.
-- =====================================================================

CREATE TABLE notification_outbox (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id  uuid NOT NULL REFERENCES organization(id),
  -- Audience spec + content, validated by the facade. See notifications/types.ts.
  payload          jsonb NOT NULL,
  enqueued_at      timestamptz NOT NULL DEFAULT now(),
  processed_at     timestamptz,
  attempts         integer NOT NULL DEFAULT 0,
  last_error       text
);

CREATE INDEX ix_notification_outbox_pending
  ON notification_outbox (organization_id, enqueued_at)
  WHERE processed_at IS NULL;

CREATE TABLE notification (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id  uuid NOT NULL REFERENCES organization(id),
  recipient_id     uuid NOT NULL,
  -- Free-form machine-readable category, e.g. 'lead.assigned'. Modules add
  -- types without a migration; the registry of known types is a TS constant.
  type             text NOT NULL,
  -- NT-3: operational notifications are never silenced by preferences or quiet hours.
  priority         text NOT NULL DEFAULT 'informational'
                     CHECK (priority IN ('informational', 'operational')),
  title            text NOT NULL,
  body             text NOT NULL DEFAULT '',
  -- NT-5: in-app deep link to the exact record.
  link             text,
  metadata         jsonb NOT NULL DEFAULT '{}'::jsonb,
  read_at          timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  -- NT-8: pruned by a scheduled job once expired.
  expires_at       timestamptz,
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, recipient_id) REFERENCES app_user (organization_id, id)
);

-- Unread badge + centre list, newest first.
CREATE INDEX ix_notification_recipient_unread
  ON notification (organization_id, recipient_id, created_at DESC)
  WHERE read_at IS NULL;
-- Full history, newest first (id breaks created_at ties for cursor paging).
CREATE INDEX ix_notification_recipient_history
  ON notification (organization_id, recipient_id, created_at DESC, id DESC);
CREATE INDEX ix_notification_expiry
  ON notification (expires_at) WHERE expires_at IS NOT NULL;

CREATE TABLE notification_delivery (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id  uuid NOT NULL REFERENCES organization(id),
  notification_id  uuid NOT NULL,
  recipient_id     uuid NOT NULL,
  channel          text NOT NULL CHECK (channel IN ('in-app', 'email', 'push', 'whatsapp')),
  status           text NOT NULL CHECK (status IN ('delivered', 'failed', 'skipped')),
  detail           text,
  attempted_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ix_notification_delivery_notification
  ON notification_delivery (organization_id, notification_id);

SELECT apply_tenant_rls('notification_outbox');
SELECT apply_tenant_rls('notification');
SELECT apply_tenant_rls('notification_delivery');
-- Default privileges from 0001 already grant the runtime role SELECT/INSERT/
-- UPDATE/DELETE on tables created here.
