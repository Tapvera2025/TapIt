-- =====================================================================
-- 0020 - Per-user geofenced login
-- =====================================================================

ALTER TABLE app_user
  ADD COLUMN IF NOT EXISTS geofence_required boolean NOT NULL DEFAULT false;
