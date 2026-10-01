-- =====================================================================
-- 0063 — @mentions in group/project chats
-- =====================================================================
CREATE TABLE message_mention (
  message_id       uuid NOT NULL,
  organization_id  uuid NOT NULL REFERENCES organization(id),
  user_id          uuid NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id),
  FOREIGN KEY (organization_id, message_id) REFERENCES message (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, user_id) REFERENCES app_user (organization_id, id)
);

SELECT apply_tenant_rls('message_mention');
-- Default privileges from 0001 already grant the runtime role SELECT/INSERT/
-- UPDATE/DELETE on tables created here.
