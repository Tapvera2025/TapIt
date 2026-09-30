-- =====================================================================
-- 0055 — Task Assignee Status (Independent Multi-Assignee Task Status)
--
-- Adds status column to task_assignee so each assignee has independent status.
-- =====================================================================

ALTER TABLE task_assignee
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending'
  CHECK (status IN ('pending', 'in_progress', 'completed', 'cancelled'));

-- Backfill existing task_assignee records from their task's status
UPDATE task_assignee ta
SET status = t.status
FROM task t
WHERE t.organization_id = ta.organization_id AND t.id = ta.task_id;

CREATE INDEX IF NOT EXISTS ix_task_assignee_status
  ON task_assignee (organization_id, status);
