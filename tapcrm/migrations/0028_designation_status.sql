-- OR-11: designations are editable configuration and can be deactivated without
-- breaking employees who already reference them.
ALTER TABLE designation
  ADD COLUMN status text NOT NULL DEFAULT 'active'
  CHECK (status IN ('active', 'inactive'));

CREATE UNIQUE INDEX ux_designation_org_name
  ON designation (organization_id, lower(name));

CREATE TRIGGER trg_designation_updated BEFORE UPDATE ON designation
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
