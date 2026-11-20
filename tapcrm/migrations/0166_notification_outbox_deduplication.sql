ALTER TABLE notification_outbox
  ADD COLUMN IF NOT EXISTS deduplication_key text;

CREATE UNIQUE INDEX IF NOT EXISTS ux_notification_outbox_deduplication
  ON notification_outbox (organization_id, deduplication_key)
  WHERE deduplication_key IS NOT NULL;
