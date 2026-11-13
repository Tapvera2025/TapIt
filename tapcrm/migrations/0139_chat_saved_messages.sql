-- =====================================================================
-- 0139 — Chat: starred / saved messages ("Save for later")
--
-- A personal review tray: each row is one person's bookmark on one message.
-- Nobody else ever sees another person's saved list. Leaving a conversation
-- hides its saved messages from the tray (they are read through current
-- membership), and deleting a conversation removes them.
-- =====================================================================

CREATE TABLE message_star (
  user_id          uuid NOT NULL,
  message_id       uuid NOT NULL,
  organization_id  uuid NOT NULL REFERENCES organization(id),
  conversation_id  uuid NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, message_id),
  FOREIGN KEY (organization_id, message_id) REFERENCES message (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, conversation_id) REFERENCES conversation (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, user_id) REFERENCES app_user (organization_id, id)
);

-- The tray: my saved messages, most recently saved first.
CREATE INDEX ix_message_star_user
  ON message_star (organization_id, user_id, created_at DESC, message_id DESC);

SELECT apply_tenant_rls('message_star');
