-- Finance Phase 8: cash-flow command centre, forecast snapshots and scenarios.
-- Forecasts are advisory projections; they never post journals or mutate source data.

CREATE TABLE finance_cash_flow_snapshot (
  id uuid PRIMARY KEY DEFAULT uuidv7(), organization_id uuid NOT NULL REFERENCES organization(id),
  as_of_date date NOT NULL, horizon_weeks smallint NOT NULL CHECK (horizon_weeks BETWEEN 1 AND 52),
  base_currency text NOT NULL CHECK (base_currency ~ '^[A-Z]{3}$'), minimum_cash numeric(18,2) NOT NULL DEFAULT 0 CHECK (minimum_cash >= 0),
  source_hash text NOT NULL, source_data jsonb NOT NULL DEFAULT '{}'::jsonb, created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,id), UNIQUE (organization_id,as_of_date,horizon_weeks,base_currency,source_hash),
  FOREIGN KEY (organization_id,created_by) REFERENCES app_user(organization_id,id)
);

CREATE TABLE finance_cash_flow_forecast (
  id uuid PRIMARY KEY DEFAULT uuidv7(), organization_id uuid NOT NULL REFERENCES organization(id), snapshot_id uuid NOT NULL,
  bucket_number smallint NOT NULL CHECK (bucket_number > 0), bucket_start date NOT NULL, bucket_end date NOT NULL,
  opening_cash numeric(18,2) NOT NULL, contracted_cash numeric(18,2) NOT NULL DEFAULT 0,
  issued_cash numeric(18,2) NOT NULL DEFAULT 0, expected_collections numeric(18,2) NOT NULL DEFAULT 0,
  other_inflows numeric(18,2) NOT NULL DEFAULT 0, payable_outflows numeric(18,2) NOT NULL DEFAULT 0,
  recurring_outflows numeric(18,2) NOT NULL DEFAULT 0, other_outflows numeric(18,2) NOT NULL DEFAULT 0,
  closing_cash numeric(18,2) NOT NULL, minimum_cash numeric(18,2) NOT NULL DEFAULT 0,
  variance_to_minimum numeric(18,2) NOT NULL, evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (organization_id,id), UNIQUE (organization_id,snapshot_id,bucket_number),
  FOREIGN KEY (organization_id,snapshot_id) REFERENCES finance_cash_flow_snapshot(organization_id,id) ON DELETE CASCADE,
  CHECK (bucket_end >= bucket_start)
);

CREATE TABLE finance_cash_flow_scenario (
  id uuid PRIMARY KEY DEFAULT uuidv7(), organization_id uuid NOT NULL REFERENCES organization(id),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 160), base_snapshot_id uuid NOT NULL,
  base_currency text NOT NULL CHECK (base_currency ~ '^[A-Z]{3}$'), assumptions jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')), created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,id), FOREIGN KEY (organization_id,base_snapshot_id) REFERENCES finance_cash_flow_snapshot(organization_id,id),
  FOREIGN KEY (organization_id,created_by) REFERENCES app_user(organization_id,id)
);

CREATE INDEX ix_cash_flow_snapshot_date ON finance_cash_flow_snapshot(organization_id,as_of_date DESC);
CREATE INDEX ix_cash_flow_forecast_bucket ON finance_cash_flow_forecast(organization_id,bucket_start);
CREATE INDEX ix_cash_flow_scenario_status ON finance_cash_flow_scenario(organization_id,status,created_at DESC);
CREATE TRIGGER trg_cash_flow_scenario_updated BEFORE UPDATE ON finance_cash_flow_scenario FOR EACH ROW EXECUTE FUNCTION set_updated_at();

SELECT apply_tenant_rls('finance_cash_flow_snapshot'); SELECT apply_tenant_rls('finance_cash_flow_forecast'); SELECT apply_tenant_rls('finance_cash_flow_scenario');
GRANT SELECT, INSERT, UPDATE ON finance_cash_flow_snapshot, finance_cash_flow_forecast, finance_cash_flow_scenario TO tapcrm_app;
REVOKE DELETE ON finance_cash_flow_snapshot, finance_cash_flow_forecast, finance_cash_flow_scenario FROM tapcrm_app;
