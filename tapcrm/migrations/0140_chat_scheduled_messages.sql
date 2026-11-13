-- =====================================================================
-- 0140 — Chat: message scheduling ("Send later")
--
-- For teams working across time zones, and for not messaging a client at
-- the weekend. A scheduled message is a draft with a send time; the
-- `chat.scheduled-send` job (every minute, per organization) turns each due
-- one into a real message in ONE transaction — claim the row, insert the
-- message, mark it sent — so a crash can neither lose nor double-send it.
--
-- When it is due the sender must still be an active member of a live
-- conversation; otherwise the row is marked `failed` with the reason and
-- the sender is notified. Attachments uploaded for it are held by
-- `scheduled_message_id` until then (so the pending-upload cleanup leaves
-- them alone) and move onto the message when it is sent.
-- =====================================================================

CREATE TABLE scheduled_message (
  id                   uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id      uuid NOT NULL REFERENCES organization(id),
  conversation_id      uuid NOT NULL,
  sender_id            uuid NOT NULL,
  body                 text NOT NULL DEFAULT '' CHECK (char_length(body) <= 10000),
  reply_to_message_id  uuid,
  mentioned_user_ids   uuid[] NOT NULL DEFAULT '{}',
  send_at              timestamptz NOT NULL,
  status               text NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending', 'sent', 'cancelled', 'failed')),
  sent_message_id      uuid,
  sent_at              timestamptz,
  failure_reason       text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, conversation_id) REFERENCES conversation (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, sender_id) REFERENCES app_user (organization_id, id),
  FOREIGN KEY (organization_id, reply_to_message_id) REFERENCES message (organization_id, id),
  FOREIGN KEY (organization_id, sent_message_id) REFERENCES message (organization_id, id),
  CHECK (status <> 'sent' OR sent_message_id IS NOT NULL)
);

-- The sweep: due rows, oldest first.
CREATE INDEX ix_scheduled_message_due
  ON scheduled_message (organization_id, send_at)
  WHERE status = 'pending';

-- "My scheduled messages" (optionally in one conversation).
CREATE INDEX ix_scheduled_message_sender
  ON scheduled_message (organization_id, sender_id, conversation_id, send_at)
  WHERE status = 'pending';

CREATE TRIGGER scheduled_message_set_updated_at
  BEFORE UPDATE ON scheduled_message
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE message_attachment ADD COLUMN scheduled_message_id uuid;
ALTER TABLE message_attachment
  ADD CONSTRAINT message_attachment_scheduled_message_fkey
  FOREIGN KEY (organization_id, scheduled_message_id) REFERENCES scheduled_message (organization_id, id);
ALTER TABLE message_attachment
  ADD CONSTRAINT message_attachment_one_owner CHECK (message_id IS NULL OR scheduled_message_id IS NULL);

-- The cleanup sweep must skip uploads a scheduled message is holding.
DROP INDEX ix_message_attachment_pending;
CREATE INDEX ix_message_attachment_pending
  ON message_attachment (organization_id, created_at)
  WHERE message_id IS NULL AND scheduled_message_id IS NULL;

CREATE INDEX ix_message_attachment_scheduled
  ON message_attachment (organization_id, scheduled_message_id, position)
  WHERE scheduled_message_id IS NOT NULL;

SELECT apply_tenant_rls('scheduled_message');
