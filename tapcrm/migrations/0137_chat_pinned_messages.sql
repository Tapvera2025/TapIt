-- =====================================================================
-- 0137 — Chat: pinned messages
--
-- Instructions, project scopes and client approvals pinned to the header of
-- a conversation. Any employee member may pin or unpin (product decision);
-- client accounts see the pins of their project group but cannot change
-- them. Unsending a message unpins it.
-- =====================================================================

CREATE TABLE message_pin (
  conversation_id  uuid NOT NULL,
  message_id       uuid NOT NULL,
  organization_id  uuid NOT NULL REFERENCES organization(id),
  pinned_by        uuid NOT NULL,
  pinned_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, message_id),
  FOREIGN KEY (organization_id, conversation_id) REFERENCES conversation (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, message_id) REFERENCES message (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, pinned_by) REFERENCES app_user (organization_id, id)
);

CREATE INDEX ix_message_pin_conversation
  ON message_pin (organization_id, conversation_id, pinned_at DESC);

CREATE UNIQUE INDEX ix_message_pin_message
  ON message_pin (organization_id, message_id);

SELECT apply_tenant_rls('message_pin');
