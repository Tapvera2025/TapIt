-- =====================================================================
-- 0006 — Organization module entitlements
-- =====================================================================
CREATE TABLE organization_module (
  organization_id  uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  module_id        uuid NOT NULL REFERENCES module(id) ON DELETE RESTRICT,
  status           text NOT NULL DEFAULT 'enabled' CHECK (status IN ('enabled', 'disabled')),
  enabled_at       timestamptz,
  disabled_at      timestamptz,
  enabled_by       uuid REFERENCES platform_user(id),
  disabled_by      uuid REFERENCES platform_user(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, module_id)
);

CREATE INDEX ix_organization_module_status ON organization_module(organization_id, status);
-- Control-plane table: accessed through platformDb, not tenant db.
GRANT SELECT, INSERT, UPDATE, DELETE ON organization_module TO tapcrm_app;

CREATE TRIGGER organization_module_updated_at
BEFORE UPDATE ON organization_module
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
