-- Employee advances and their recovery schedule. Payroll integration is intentionally deferred.
INSERT INTO module (key, name, description, is_core)
VALUES ('advance', 'Advances', 'Employee advance requests and recovery schedules', false)
ON CONFLICT (key) DO NOTHING;
INSERT INTO module_dependency (module_id, depends_on_module_id)
SELECT m.id, d.id FROM module m CROSS JOIN module d
WHERE m.key = 'advance' AND d.key = 'employee-directory'
ON CONFLICT DO NOTHING;

CREATE TABLE employee_advance (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL REFERENCES organization(id),
  employee_id uuid NOT NULL,
  requested_amount_paise bigint NOT NULL CHECK (requested_amount_paise > 0),
  approved_amount_paise bigint CHECK (approved_amount_paise IS NULL OR approved_amount_paise > 0),
  requested_for_period date NOT NULL CHECK (requested_for_period = date_trunc('month', requested_for_period)::date),
  requested_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  source text NOT NULL DEFAULT 'employee_request' CHECK (source IN ('employee_request','manual')),
  reason text NOT NULL CHECK (char_length(btrim(reason)) > 0),
  approved_at timestamptz,
  approved_by uuid,
  rejected_at timestamptz,
  rejected_by uuid,
  rejection_reason text,
  approval_note text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, employee_id) REFERENCES app_user(organization_id, id),
  FOREIGN KEY (organization_id, approved_by) REFERENCES app_user(organization_id, id),
  FOREIGN KEY (organization_id, rejected_by) REFERENCES app_user(organization_id, id),
  FOREIGN KEY (organization_id, created_by) REFERENCES app_user(organization_id, id),
  CHECK (approved_amount_paise IS NULL OR approved_amount_paise <= requested_amount_paise),
  CHECK ((status = 'approved') = (approved_amount_paise IS NOT NULL AND approved_at IS NOT NULL AND approved_by IS NOT NULL)),
  CHECK ((status = 'rejected') = (rejection_reason IS NOT NULL AND rejected_at IS NOT NULL AND rejected_by IS NOT NULL))
);

CREATE INDEX employee_advance_org_status_idx ON employee_advance (organization_id, status, requested_at DESC);
CREATE INDEX employee_advance_org_employee_idx ON employee_advance (organization_id, employee_id, requested_at DESC);
CREATE INDEX employee_advance_org_period_idx ON employee_advance (organization_id, requested_for_period);

CREATE TABLE employee_advance_deduction (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL REFERENCES organization(id),
  advance_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  payroll_period date NOT NULL CHECK (payroll_period = date_trunc('month', payroll_period)::date),
  scheduled_amount_paise bigint NOT NULL CHECK (scheduled_amount_paise > 0),
  deducted_amount_paise bigint NOT NULL DEFAULT 0 CHECK (deducted_amount_paise >= 0 AND deducted_amount_paise <= scheduled_amount_paise),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','partial','completed','cancelled')),
  deducted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, advance_id, payroll_period),
  FOREIGN KEY (organization_id, advance_id) REFERENCES employee_advance(organization_id, id),
  FOREIGN KEY (organization_id, employee_id) REFERENCES app_user(organization_id, id)
);
CREATE INDEX employee_advance_deduction_org_period_idx ON employee_advance_deduction (organization_id, payroll_period);
CREATE INDEX employee_advance_deduction_org_status_idx ON employee_advance_deduction (organization_id, status);

SELECT apply_tenant_rls('employee_advance');
SELECT apply_tenant_rls('employee_advance_deduction');
GRANT SELECT, INSERT, UPDATE ON employee_advance TO tapcrm_app;
GRANT SELECT, INSERT, UPDATE ON employee_advance_deduction TO tapcrm_app;
REVOKE DELETE ON employee_advance FROM tapcrm_app;
REVOKE DELETE ON employee_advance_deduction FROM tapcrm_app;
