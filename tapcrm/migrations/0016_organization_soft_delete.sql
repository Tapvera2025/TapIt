-- =====================================================================
-- 0016 - Persist platform organization removal without deleting tenant data
-- =====================================================================
ALTER TABLE organization
  ADD COLUMN deleted_at timestamptz;
