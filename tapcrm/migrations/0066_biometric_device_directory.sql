-- =====================================================================
-- 0066 - Biometric device directory (G2, attendance design §10.5)
--
-- A device's push (`/iclock/...?SN=<serial>`) carries no user token and no
-- tenant. This small global directory answers the one question the machine
-- endpoint must ask before a tenant context exists — which organization and
-- device own this serial — and nothing else. `biometric_device` stays the
-- authority and is read under ordinary RLS once the tenant is known.
--
-- Serials are globally unique here: one physical device pushes to one
-- company. A serial already registered to another company is refused at
-- registration, never silently re-pointed. Existing duplicates (none are
-- expected) are left out of the backfill for an administrator to resolve;
-- their pushes are ignored until then.
--
-- The directory is written only by the trigger below (SECURITY DEFINER, fixed
-- search path). The runtime role can read it and nothing more.
-- =====================================================================

CREATE TABLE biometric_device_directory (
  serial_number   text PRIMARY KEY CHECK (serial_number ~ '^[A-Za-z0-9._-]{1,64}$'),
  organization_id uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  device_id       uuid NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, device_id),
  FOREIGN KEY (organization_id, device_id) REFERENCES biometric_device (organization_id, id) ON DELETE CASCADE
);

INSERT INTO biometric_device_directory (serial_number, organization_id, device_id)
SELECT d.serial_number, d.organization_id, d.id
FROM biometric_device d
WHERE (SELECT count(*) FROM biometric_device other WHERE other.serial_number = d.serial_number) = 1;

CREATE FUNCTION sync_biometric_device_directory() RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (
    OLD.serial_number IS DISTINCT FROM NEW.serial_number OR
    OLD.organization_id IS DISTINCT FROM NEW.organization_id
  ) THEN
    DELETE FROM biometric_device_directory
    WHERE organization_id = OLD.organization_id AND device_id = OLD.id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM biometric_device_directory
    WHERE serial_number = NEW.serial_number
      AND NOT (organization_id = NEW.organization_id AND device_id = NEW.id)
  ) THEN
    RAISE EXCEPTION 'Device serial % is registered to another company', NEW.serial_number
      USING ERRCODE = '23505';
  END IF;

  INSERT INTO biometric_device_directory (serial_number, organization_id, device_id)
  VALUES (NEW.serial_number, NEW.organization_id, NEW.id)
  ON CONFLICT (serial_number) DO NOTHING;
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION sync_biometric_device_directory() FROM PUBLIC;

CREATE TRIGGER trg_biometric_device_directory
  AFTER INSERT OR UPDATE OF serial_number, organization_id ON biometric_device
  FOR EACH ROW
  EXECUTE FUNCTION sync_biometric_device_directory();

-- Read-only for the runtime role: the trigger is the only writer.
REVOKE ALL ON biometric_device_directory FROM PUBLIC;
REVOKE ALL ON biometric_device_directory FROM tapcrm_app;
GRANT SELECT ON biometric_device_directory TO tapcrm_app;
