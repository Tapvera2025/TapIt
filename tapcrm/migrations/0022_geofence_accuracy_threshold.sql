-- =====================================================================
-- 0022 - Per-location browser accuracy threshold
-- =====================================================================

ALTER TABLE geofence_location
  ADD COLUMN IF NOT EXISTS accuracy_threshold_metres integer NOT NULL DEFAULT 100
  CHECK (accuracy_threshold_metres > 0);
