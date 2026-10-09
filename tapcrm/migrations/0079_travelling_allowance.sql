-- Travelling Allowance management. TA is reviewed here and only becomes a
-- payroll input after an explicit HR/payroll handoff.
ALTER TABLE payroll_input
  DROP CONSTRAINT IF EXISTS payroll_input_kind_check;
ALTER TABLE payroll_input
  ADD CONSTRAINT payroll_input_kind_check
  CHECK (kind IN ('break-deduction', 'adjustment', 'advance-recovery', 'arrear', 'bonus', 'tds', 'travel-allowance'));
ALTER TABLE payroll_input ADD COLUMN IF NOT EXISTS source_type text;
ALTER TABLE payroll_input ADD COLUMN IF NOT EXISTS source_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS uq_payroll_input_active_source
  ON payroll_input (organization_id, source_type, source_id)
  WHERE source_type IS NOT NULL AND source_id IS NOT NULL AND revoked_at IS NULL;

CREATE TABLE employee_ta_entitlement (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL REFERENCES organization(id),
  employee_id uuid NOT NULL,
  amount_paise bigint NOT NULL CHECK (amount_paise > 0),
  frequency text NOT NULL DEFAULT 'monthly' CHECK (frequency = 'monthly'),
  effective_from date NOT NULL,
  effective_to date,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  remarks text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, employee_id) REFERENCES app_user(organization_id, id),
  FOREIGN KEY (organization_id, created_by) REFERENCES app_user(organization_id, id),
  FOREIGN KEY (organization_id, updated_by) REFERENCES app_user(organization_id, id),
  CHECK (effective_to IS NULL OR effective_to >= effective_from)
);
-- Foreign keys are tenant-scoped throughout the schema. PostgreSQL requires
-- the referenced tenant/id pair to be explicitly unique.
ALTER TABLE employee_ta_entitlement
  ADD CONSTRAINT uq_employee_ta_entitlement_org_id UNIQUE (organization_id, id);
CREATE INDEX employee_ta_entitlement_org_effective_idx ON employee_ta_entitlement(organization_id, effective_from, effective_to, status);

CREATE TABLE employee_ta_entry (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL REFERENCES organization(id),
  employee_id uuid NOT NULL,
  entitlement_id uuid,
  payroll_period date NOT NULL CHECK (payroll_period = date_trunc('month', payroll_period)::date),
  travel_date date,
  amount_paise bigint NOT NULL CHECK (amount_paise > 0),
  source_type text NOT NULL CHECK (source_type IN ('recurring', 'one-time')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'ready', 'sent', 'revoked')),
  payroll_input_id uuid,
  remarks text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_by uuid,
  sent_at timestamptz,
  revoked_by uuid,
  revoked_at timestamptz,
  revoke_reason text,
  FOREIGN KEY (organization_id, employee_id) REFERENCES app_user(organization_id, id),
  FOREIGN KEY (organization_id, entitlement_id) REFERENCES employee_ta_entitlement(organization_id, id),
  FOREIGN KEY (organization_id, created_by) REFERENCES app_user(organization_id, id),
  FOREIGN KEY (organization_id, sent_by) REFERENCES app_user(organization_id, id),
  FOREIGN KEY (organization_id, revoked_by) REFERENCES app_user(organization_id, id),
  FOREIGN KEY (payroll_input_id) REFERENCES payroll_input(id),
  CHECK (source_type = 'recurring' OR travel_date IS NOT NULL)
);
CREATE UNIQUE INDEX uq_employee_ta_recurring_period ON employee_ta_entry(organization_id, entitlement_id, payroll_period) WHERE entitlement_id IS NOT NULL;
CREATE INDEX employee_ta_entry_org_period_idx ON employee_ta_entry(organization_id, payroll_period, status);
SELECT apply_tenant_rls('employee_ta_entitlement');
SELECT apply_tenant_rls('employee_ta_entry');
GRANT SELECT, INSERT, UPDATE ON employee_ta_entitlement, employee_ta_entry TO tapcrm_app;
REVOKE DELETE ON employee_ta_entitlement, employee_ta_entry FROM tapcrm_app;
