-- Finance Phase 7.0-7.4: budgets, restricted costing, allocations and margins.
-- These tables are reporting/analysis data. They never create payroll or
-- accounting journals.

CREATE TABLE finance_profitability_budget (
  id uuid PRIMARY KEY DEFAULT uuidv7(), organization_id uuid NOT NULL REFERENCES organization(id),
  project_id uuid NOT NULL, client_id uuid NOT NULL, name text NOT NULL,
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'), period_start date NOT NULL, period_end date NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','approved','closed')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0), reason text NOT NULL,
  created_by uuid NOT NULL, approved_by uuid, approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,id), UNIQUE (organization_id,project_id,period_start,version),
  FOREIGN KEY (organization_id,project_id) REFERENCES project(organization_id,id),
  FOREIGN KEY (organization_id,client_id) REFERENCES client(organization_id,id),
  FOREIGN KEY (organization_id,created_by) REFERENCES app_user(organization_id,id),
  FOREIGN KEY (organization_id,approved_by) REFERENCES app_user(organization_id,id),
  CHECK (period_end >= period_start)
);

CREATE TABLE finance_profitability_budget_line (
  id uuid PRIMARY KEY DEFAULT uuidv7(), organization_id uuid NOT NULL REFERENCES organization(id),
  budget_id uuid NOT NULL, category text NOT NULL CHECK (category IN ('staff_time','vendor','advertising','other')),
  amount numeric(18,2) NOT NULL CHECK (amount >= 0), reason text NOT NULL,
  UNIQUE (organization_id,id), UNIQUE (organization_id,budget_id,category),
  FOREIGN KEY (organization_id,budget_id) REFERENCES finance_profitability_budget(organization_id,id) ON DELETE CASCADE
);

CREATE TABLE finance_profitability_cost_rate (
  id uuid PRIMARY KEY DEFAULT uuidv7(), organization_id uuid NOT NULL REFERENCES organization(id),
  user_id uuid, role_code text, currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  hourly_rate numeric(18,2) NOT NULL CHECK (hourly_rate >= 0), effective_from date NOT NULL, effective_to date,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')), reason text NOT NULL,
  created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,id),
  FOREIGN KEY (organization_id,user_id) REFERENCES app_user(organization_id,id),
  FOREIGN KEY (organization_id,created_by) REFERENCES app_user(organization_id,id),
  CHECK (num_nonnulls(user_id,role_code) = 1), CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE TABLE finance_profitability_cost_entry (
  id uuid PRIMARY KEY DEFAULT uuidv7(), organization_id uuid NOT NULL REFERENCES organization(id),
  project_id uuid, client_id uuid, category text NOT NULL CHECK (category IN ('staff_time','payroll','vendor','other')),
  allocation_mode text NOT NULL CHECK (allocation_mode IN ('direct','shared')), source_type text NOT NULL, source_id uuid NOT NULL,
  work_date date NOT NULL, hours numeric(18,4), hourly_rate numeric(18,2), amount numeric(18,2) NOT NULL CHECK (amount >= 0),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'), description text NOT NULL,
  created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,id), UNIQUE (organization_id,source_type,source_id),
  FOREIGN KEY (organization_id,project_id) REFERENCES project(organization_id,id),
  FOREIGN KEY (organization_id,client_id) REFERENCES client(organization_id,id),
  FOREIGN KEY (organization_id,created_by) REFERENCES app_user(organization_id,id),
  CHECK (allocation_mode = 'shared' OR project_id IS NOT NULL),
  CHECK (hours IS NULL OR hours > 0), CHECK (hourly_rate IS NULL OR hourly_rate >= 0)
);

CREATE TABLE finance_profitability_revenue (
  id uuid PRIMARY KEY DEFAULT uuidv7(), organization_id uuid NOT NULL REFERENCES organization(id),
  project_id uuid NOT NULL, client_id uuid NOT NULL, source_type text NOT NULL, source_id uuid NOT NULL,
  period_start date NOT NULL, amount numeric(18,2) NOT NULL CHECK (amount >= 0), currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  reason text NOT NULL, created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,id), UNIQUE (organization_id,source_type,source_id),
  FOREIGN KEY (organization_id,project_id) REFERENCES project(organization_id,id),
  FOREIGN KEY (organization_id,client_id) REFERENCES client(organization_id,id),
  FOREIGN KEY (organization_id,created_by) REFERENCES app_user(organization_id,id)
);

CREATE TABLE finance_profitability_allocation_run (
  id uuid PRIMARY KEY DEFAULT uuidv7(), organization_id uuid NOT NULL REFERENCES organization(id),
  period_start date NOT NULL, period_end date NOT NULL, driver text NOT NULL CHECK (driver IN ('equal','budget','approved_hours')),
  manifest jsonb NOT NULL, manifest_sha256 text NOT NULL, status text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','approved','reversed')),
  reason text NOT NULL, created_by uuid NOT NULL, approved_by uuid, created_at timestamptz NOT NULL DEFAULT now(), approved_at timestamptz,
  UNIQUE (organization_id,id), UNIQUE (organization_id,manifest_sha256),
  FOREIGN KEY (organization_id,created_by) REFERENCES app_user(organization_id,id), FOREIGN KEY (organization_id,approved_by) REFERENCES app_user(organization_id,id),
  CHECK (period_end >= period_start)
);

CREATE TABLE finance_profitability_allocation (
  id uuid PRIMARY KEY DEFAULT uuidv7(), organization_id uuid NOT NULL REFERENCES organization(id), run_id uuid NOT NULL, cost_entry_id uuid NOT NULL,
  project_id uuid NOT NULL, amount numeric(18,2) NOT NULL CHECK (amount >= 0), weight numeric(18,8) NOT NULL CHECK (weight >= 0),
  UNIQUE (organization_id,id), UNIQUE (organization_id,run_id,cost_entry_id,project_id),
  FOREIGN KEY (organization_id,run_id) REFERENCES finance_profitability_allocation_run(organization_id,id),
  FOREIGN KEY (organization_id,cost_entry_id) REFERENCES finance_profitability_cost_entry(organization_id,id),
  FOREIGN KEY (organization_id,project_id) REFERENCES project(organization_id,id)
);

CREATE TABLE finance_profitability_margin_snapshot (
  id uuid PRIMARY KEY DEFAULT uuidv7(), organization_id uuid NOT NULL REFERENCES organization(id), project_id uuid NOT NULL, client_id uuid NOT NULL,
  period_start date NOT NULL, period_end date NOT NULL, currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'), revenue numeric(18,2) NOT NULL,
  direct_cost numeric(18,2) NOT NULL, shared_cost numeric(18,2) NOT NULL, contribution numeric(18,2) NOT NULL, contribution_percent numeric(9,4),
  source_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,project_id,period_start,period_end,source_hash),
  FOREIGN KEY (organization_id,project_id) REFERENCES project(organization_id,id), FOREIGN KEY (organization_id,client_id) REFERENCES client(organization_id,id)
);

CREATE INDEX ix_profitability_budget_project ON finance_profitability_budget(organization_id,project_id,period_start);
CREATE INDEX ix_profitability_cost_period ON finance_profitability_cost_entry(organization_id,work_date,allocation_mode);
CREATE INDEX ix_profitability_revenue_period ON finance_profitability_revenue(organization_id,project_id,period_start);
CREATE INDEX ix_profitability_allocation_run ON finance_profitability_allocation_run(organization_id,status,period_start);

CREATE TRIGGER trg_profitability_budget_updated BEFORE UPDATE ON finance_profitability_budget FOR EACH ROW EXECUTE FUNCTION set_updated_at();

SELECT apply_tenant_rls('finance_profitability_budget'); SELECT apply_tenant_rls('finance_profitability_budget_line');
SELECT apply_tenant_rls('finance_profitability_cost_rate'); SELECT apply_tenant_rls('finance_profitability_cost_entry');
SELECT apply_tenant_rls('finance_profitability_revenue'); SELECT apply_tenant_rls('finance_profitability_allocation_run');
SELECT apply_tenant_rls('finance_profitability_allocation'); SELECT apply_tenant_rls('finance_profitability_margin_snapshot');

GRANT SELECT,INSERT,UPDATE ON finance_profitability_budget,finance_profitability_budget_line,finance_profitability_cost_rate,finance_profitability_cost_entry,finance_profitability_revenue,finance_profitability_allocation_run,finance_profitability_allocation,finance_profitability_margin_snapshot TO tapcrm_app;
REVOKE DELETE ON finance_profitability_budget,finance_profitability_budget_line,finance_profitability_cost_rate,finance_profitability_cost_entry,finance_profitability_revenue,finance_profitability_allocation_run,finance_profitability_allocation,finance_profitability_margin_snapshot FROM tapcrm_app;
