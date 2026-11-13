-- =====================================================================
-- 0153 — Chat: Internal Group admins, and deleting a group
--
-- An Internal Group's creator (the Super Admin who made it) can promote
-- members to group admin. Admins help run the group: they edit its name
-- and description, add people and remove ordinary members. Only the
-- creator (or a Super Admin) promotes or demotes admins, removes an admin,
-- archives, restores or deletes the group.
--
-- Deleting is a soft delete (product decision: "hidden, kept on record").
-- The group disappears for everyone and cannot be opened again from the
-- app, but its rows stay so the history can be recovered if ever needed.
-- A deleted group is also marked archived, so every read path that
-- already skips archived conversations (search, saved, presence, unread
-- counts, scheduled sends, uploads) skips it too.
-- =====================================================================

ALTER TABLE conversation_member
  ADD COLUMN role text NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'admin'));

ALTER TABLE conversation
  ADD COLUMN deleted_at timestamptz,
  ADD COLUMN deleted_by uuid,
  ADD CONSTRAINT conversation_deleted_by_fkey
    FOREIGN KEY (organization_id, deleted_by) REFERENCES app_user (organization_id, id),
  ADD CONSTRAINT conversation_deleted_is_archived
    CHECK (deleted_at IS NULL OR archived_at IS NOT NULL);
