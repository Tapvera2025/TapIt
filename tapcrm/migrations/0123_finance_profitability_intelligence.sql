-- Finance Phase 7.5-7.8: leakage, utilisation, advertising and freshness.

ALTER TABLE finance_profitability_cost_entry
  ADD COLUMN IF NOT EXISTS billable_hours numeric(18,4);
ALTER TABLE finance_profitability_cost_entry
  ADD CONSTRAINT finance_profitability_billable_hours_check
  CHECK (billable_hours IS NULL OR (billable_hours >= 0 AND (hours IS NULL OR billable_hours <= hours)));

ALTER TABLE finance_profitability_margin_snapshot
  ADD COLUMN IF NOT EXISTS advertising_cost numeric(18,2) NOT NULL DEFAULT 0;

CREATE TABLE finance_profitability_metric_snapshot (
  id uuid PRIMARY KEY DEFAULT uuidv7(), organization_id uuid NOT NULL REFERENCES organization(id), project_id uuid NOT NULL, client_id uuid NOT NULL,
  period_start date NOT NULL, period_end date NOT NULL, currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  billable_hours numeric(18,4) NOT NULL DEFAULT 0, available_hours numeric(18,4) NOT NULL DEFAULT 0,
  recognized_revenue numeric(18,2) NOT NULL DEFAULT 0, theoretical_value numeric(18,2) NOT NULL DEFAULT 0,
  utilization_percent numeric(9,4), realization_percent numeric(9,4), source_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,project_id,period_start,period_end,source_hash),
  FOREIGN KEY (organization_id,project_id) REFERENCES project(organization_id,id), FOREIGN KEY (organization_id,client_id) REFERENCES client(organization_id,id)
);

CREATE TABLE finance_profitability_leakage_finding (
  id uuid PRIMARY KEY DEFAULT uuidv7(), organization_id uuid NOT NULL REFERENCES organization(id), project_id uuid NOT NULL, client_id uuid NOT NULL,
  period_start date NOT NULL, period_end date NOT NULL, finding_type text NOT NULL CHECK (finding_type IN ('unbilled_revenue','missing_cost','unattributed_cost','budget_overrun')),
  severity text NOT NULL CHECK (severity IN ('low','medium','high')), amount numeric(18,2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  evidence jsonb NOT NULL, status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','acknowledged','resolved')), resolution text,
  detected_at timestamptz NOT NULL DEFAULT now(), resolved_by uuid, resolved_at timestamptz,
  UNIQUE (organization_id,project_id,period_start,period_end,finding_type),
  FOREIGN KEY (organization_id,project_id) REFERENCES project(organization_id,id), FOREIGN KEY (organization_id,client_id) REFERENCES client(organization_id,id), FOREIGN KEY (organization_id,resolved_by) REFERENCES app_user(organization_id,id),
  CHECK ((status = 'resolved') = (resolved_by IS NOT NULL AND resolved_at IS NOT NULL AND resolution IS NOT NULL))
);

CREATE TABLE finance_advertising_account (
  id uuid PRIMARY KEY DEFAULT uuidv7(), organization_id uuid NOT NULL REFERENCES organization(id), provider text NOT NULL CHECK (provider IN ('google_ads','meta_ads','manual')),
  external_account_id text NOT NULL, name text NOT NULL, project_id uuid, client_id uuid, funding_model text NOT NULL CHECK (funding_model IN ('client_funded','company_funded','shared')),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'), encrypted_credentials text, status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','needs_review')),
  freshness_hours integer NOT NULL DEFAULT 48 CHECK (freshness_hours BETWEEN 1 AND 8760), last_sync_at timestamptz, last_sync_status text, last_sync_message text,
  created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,id), UNIQUE (organization_id,provider,external_account_id),
  FOREIGN KEY (organization_id,project_id) REFERENCES project(organization_id,id), FOREIGN KEY (organization_id,client_id) REFERENCES client(organization_id,id), FOREIGN KEY (organization_id,created_by) REFERENCES app_user(organization_id,id)
);

CREATE TABLE finance_advertising_sync (
  id uuid PRIMARY KEY DEFAULT uuidv7(), organization_id uuid NOT NULL REFERENCES organization(id), account_id uuid NOT NULL, period_start date NOT NULL, period_end date NOT NULL,
  status text NOT NULL CHECK (status IN ('running','succeeded','failed')), records_imported integer NOT NULL DEFAULT 0, error_message text, started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz,
  UNIQUE (organization_id,id), FOREIGN KEY (organization_id,account_id) REFERENCES finance_advertising_account(organization_id,id)
);

CREATE TABLE finance_advertising_spend (
  id uuid PRIMARY KEY DEFAULT uuidv7(), organization_id uuid NOT NULL REFERENCES organization(id), account_id uuid NOT NULL, project_id uuid, client_id uuid,
  external_spend_id text NOT NULL, spend_date date NOT NULL, campaign_name text, amount numeric(18,2) NOT NULL CHECK (amount >= 0), currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'), raw_payload_hash text NOT NULL, imported_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,id), UNIQUE (organization_id,account_id,external_spend_id),
  FOREIGN KEY (organization_id,account_id) REFERENCES finance_advertising_account(organization_id,id), FOREIGN KEY (organization_id,project_id) REFERENCES project(organization_id,id), FOREIGN KEY (organization_id,client_id) REFERENCES client(organization_id,id)
);

CREATE INDEX ix_profitability_leakage_status ON finance_profitability_leakage_finding(organization_id,status,period_end DESC);
CREATE INDEX ix_profitability_metric_period ON finance_profitability_metric_snapshot(organization_id,period_end DESC);
CREATE INDEX ix_ad_account_freshness ON finance_advertising_account(organization_id,status,last_sync_at);
CREATE INDEX ix_ad_spend_period ON finance_advertising_spend(organization_id,spend_date,account_id);
CREATE TRIGGER trg_ad_account_updated BEFORE UPDATE ON finance_advertising_account FOR EACH ROW EXECUTE FUNCTION set_updated_at();

SELECT apply_tenant_rls('finance_profitability_metric_snapshot'); SELECT apply_tenant_rls('finance_profitability_leakage_finding');
SELECT apply_tenant_rls('finance_advertising_account'); SELECT apply_tenant_rls('finance_advertising_sync'); SELECT apply_tenant_rls('finance_advertising_spend');
GRANT SELECT,INSERT,UPDATE ON finance_profitability_metric_snapshot,finance_profitability_leakage_finding,finance_advertising_account,finance_advertising_sync,finance_advertising_spend TO tapcrm_app;
REVOKE DELETE ON finance_profitability_metric_snapshot,finance_profitability_leakage_finding,finance_advertising_account,finance_advertising_sync,finance_advertising_spend FROM tapcrm_app;
