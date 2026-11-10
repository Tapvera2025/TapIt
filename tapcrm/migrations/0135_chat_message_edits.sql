-- =====================================================================
-- 0135 — Chat: message editing
--
-- A sender may correct their own message for a short window after sending
-- (15 minutes, enforced by the chat service). Every edit keeps the text it
-- replaced in `message_edit`, and any member of the conversation can open
-- that history: a corrected address is visible as a correction, and a
-- message a client approved cannot be quietly rewritten afterwards.
--
-- Unsending a message removes its edit history together with its body.
-- =====================================================================

ALTER TABLE message ADD COLUMN edited_at timestamptz;

CREATE TABLE message_edit (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id  uuid NOT NULL REFERENCES organization(id),
  message_id       uuid NOT NULL,
  -- The text as it read BEFORE this edit.
  previous_body    text NOT NULL,
  edited_by        uuid NOT NULL,
  edited_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, message_id) REFERENCES message (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, edited_by) REFERENCES app_user (organization_id, id)
);

CREATE INDEX ix_message_edit_message
  ON message_edit (organization_id, message_id, edited_at);

SELECT apply_tenant_rls('message_edit');
