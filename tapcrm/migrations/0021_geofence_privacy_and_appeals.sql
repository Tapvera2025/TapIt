-- =====================================================================
-- 0021 - Geofence privacy, appeals, and configuration alerts
-- =====================================================================

ALTER TABLE geofence_event
  ADD COLUMN IF NOT EXISTS coordinates_ciphertext text;

CREATE TABLE geofence_bypass_request (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id  uuid NOT NULL REFERENCES organization(id),
  user_id          uuid NOT NULL,
  accuracy_metres  integer,
  latitude         numeric(9, 6),
  longitude        numeric(9, 6),
  coordinates_ciphertext text,
  reason           text NOT NULL,
  status           text NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'approved', 'denied', 'used')),
  decided_by       uuid,
  decided_at       timestamptz,
  bypass_until     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, user_id) REFERENCES app_user (organization_id, id),
  FOREIGN KEY (organization_id, decided_by) REFERENCES app_user (organization_id, id)
);

CREATE TABLE geofence_configuration_alert (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id  uuid NOT NULL REFERENCES organization(id),
  location_id      uuid NOT NULL,
  denial_count     integer NOT NULL,
  window_started_at timestamptz NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  resolved_at      timestamptz,
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, location_id) REFERENCES geofence_location (organization_id, id)
);

SELECT apply_tenant_rls('geofence_bypass_request');
SELECT apply_tenant_rls('geofence_configuration_alert');

GRANT SELECT, INSERT, UPDATE, DELETE ON geofence_bypass_request, geofence_configuration_alert TO tapcrm_app;
