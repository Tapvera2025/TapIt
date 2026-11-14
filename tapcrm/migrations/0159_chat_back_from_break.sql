-- =====================================================================
-- 0159 — Chat: "Tell me when they're back" from a break
--
-- When you open a direct message with someone who is on a break, the chat
-- shows a strip with a button. Pressing it stores one row here: you want to
-- be told when that person's break ends. When their attendance status
-- changes (the live-status `status-changed` event), chat reads their status
-- again; if the break is over it notifies everyone waiting on them and
-- deletes their rows in the same transaction, so a repeated event never
-- notifies twice.
--
-- One row per (person waiting, person on break). Pressing the button again
-- just refreshes the row. Rows are personal: nobody sees who else is
-- waiting. Deleting the conversation removes them.
-- =====================================================================

CREATE TABLE chat_break_return_watch (
  organization_id  uuid NOT NULL REFERENCES organization(id),
  watcher_id       uuid NOT NULL,
  subject_id       uuid NOT NULL,
  conversation_id  uuid NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, watcher_id, subject_id),
  FOREIGN KEY (organization_id, watcher_id) REFERENCES app_user (organization_id, id),
  FOREIGN KEY (organization_id, subject_id) REFERENCES app_user (organization_id, id),
  FOREIGN KEY (organization_id, conversation_id) REFERENCES conversation (organization_id, id) ON DELETE CASCADE,
  CHECK (watcher_id <> subject_id)
);

-- When someone's status changes: who is waiting on them.
CREATE INDEX ix_chat_break_return_watch_subject
  ON chat_break_return_watch (organization_id, subject_id);

-- "Am I waiting on this conversation?" for the strip.
CREATE INDEX ix_chat_break_return_watch_conversation
  ON chat_break_return_watch (organization_id, conversation_id, watcher_id);

SELECT apply_tenant_rls('chat_break_return_watch');
