-- =====================================================================
-- 0062 — My Todo Soft Delete
--
-- Convert physical deletion of my_todo records into soft deletion via
-- nullable deleted_at timestamp.
-- =====================================================================

ALTER TABLE my_todo
  ADD COLUMN deleted_at timestamptz;
