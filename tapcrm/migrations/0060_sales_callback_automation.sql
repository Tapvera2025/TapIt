-- Callback Phase 2: reminder instances and independent channel delivery state.

CREATE TABLE lead_callback_reminder (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL REFERENCES organization(id),
  callback_id     uuid NOT NULL,
  reminder_type   text NOT NULL CHECK (reminder_type IN ('t_minus_60', 't_minus_15', 'due')),
  scheduled_at    timestamptz NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, callback_id, reminder_type),
  FOREIGN KEY (organization_id, callback_id) REFERENCES lead_callback (organization_id, id) ON DELETE CASCADE
);

CREATE TABLE lead_callback_reminder_delivery (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL REFERENCES organization(id),
  reminder_id     uuid NOT NULL,
  recipient_id    uuid NOT NULL,
  channel         text NOT NULL CHECK (channel IN ('in-app', 'push', 'email', 'whatsapp')),
  status          text NOT NULL CHECK (status IN ('scheduled', 'sent', 'delivered', 'failed')),
  scheduled_at    timestamptz NOT NULL DEFAULT now(),
  sent_at         timestamptz,
  delivered_at    timestamptz,
  failed_at       timestamptz,
  detail          text,
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, reminder_id, recipient_id, channel),
  FOREIGN KEY (organization_id, reminder_id) REFERENCES lead_callback_reminder (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, recipient_id) REFERENCES app_user (organization_id, id)
);

SELECT apply_tenant_rls('lead_callback_reminder');
SELECT apply_tenant_rls('lead_callback_reminder_delivery');

GRANT SELECT, INSERT, UPDATE ON lead_callback_reminder, lead_callback_reminder_delivery TO tapcrm_app;

CREATE INDEX ix_callback_reminder_due ON lead_callback_reminder (organization_id, scheduled_at);
CREATE INDEX ix_callback_reminder_delivery_reminder ON lead_callback_reminder_delivery (organization_id, reminder_id);
