-- =====================================================================
-- 0052 — Sales Territories foundation
--
-- Phase 1 stores territory configuration only. Lead matching and assignment
-- are deliberately implemented in a later Sales phase.
-- =====================================================================

CREATE TABLE sales_territories (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL REFERENCES organization(id),
  name            text NOT NULL,
  description     text,
  sales_team_id   uuid NOT NULL,
  status          text NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'inactive')),
  created_by      uuid NOT NULL,
  updated_by      uuid NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, sales_team_id)
    REFERENCES team (organization_id, id),
  FOREIGN KEY (organization_id, created_by)
    REFERENCES app_user (organization_id, id),
  FOREIGN KEY (organization_id, updated_by)
    REFERENCES app_user (organization_id, id)
);

CREATE TABLE sales_territory_rules (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL REFERENCES organization(id),
  territory_id    uuid NOT NULL,
  dimension       text NOT NULL
                    CHECK (dimension IN ('geography', 'industry', 'product', 'lead_source')),
  value           text NOT NULL CHECK (length(btrim(value)) > 0),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, territory_id, dimension, value),
  FOREIGN KEY (organization_id, territory_id)
    REFERENCES sales_territories (organization_id, id) ON DELETE CASCADE
);

SELECT apply_tenant_rls('sales_territories');
SELECT apply_tenant_rls('sales_territory_rules');

CREATE TRIGGER trg_sales_territories_updated
  BEFORE UPDATE ON sales_territories
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

GRANT SELECT, INSERT, UPDATE ON sales_territories TO tapcrm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON sales_territory_rules TO tapcrm_app;

CREATE INDEX ix_sales_territories_org_team
  ON sales_territories (organization_id, sales_team_id);
CREATE INDEX ix_sales_territories_org_status
  ON sales_territories (organization_id, status);
CREATE INDEX ix_sales_territory_rules_org_territory
  ON sales_territory_rules (organization_id, territory_id);
