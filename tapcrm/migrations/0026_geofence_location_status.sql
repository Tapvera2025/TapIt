-- Geofence locations can be retired without deleting their shared reference.
ALTER TABLE geofence_location
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive'));

CREATE INDEX IF NOT EXISTS ix_geofence_location_active
  ON geofence_location (organization_id, status);
