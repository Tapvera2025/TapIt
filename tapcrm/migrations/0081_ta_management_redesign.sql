-- Daily TA is a people/attendance statement flow. The previous monthly
-- entitlement and payroll-entry tables are intentionally replaced here.
DROP TABLE IF EXISTS employee_ta_entry;
DROP TABLE IF EXISTS employee_ta_entitlement;

-- Legacy TA payroll inputs are no longer valid because the redesigned TA
-- module is employee-dashboard-only and has no payroll handoff.
DELETE FROM payroll_input WHERE kind = 'travel-allowance';

DROP INDEX IF EXISTS uq_payroll_input_active_source;
ALTER TABLE payroll_input DROP COLUMN IF EXISTS source_type;
ALTER TABLE payroll_input DROP COLUMN IF EXISTS source_id;
ALTER TABLE payroll_input DROP CONSTRAINT IF EXISTS payroll_input_kind_check;
ALTER TABLE payroll_input
  ADD CONSTRAINT payroll_input_kind_check
  CHECK (kind IN ('break-deduction', 'adjustment', 'advance-recovery', 'arrear', 'bonus', 'tds'));

INSERT INTO module (key, name, description, is_core)
VALUES ('ta', 'Travelling Allowance', 'Attendance-based employee travelling allowance statements', false)
ON CONFLICT (key) DO NOTHING;

INSERT INTO module_dependency (module_id, depends_on_module_id)
SELECT ta.id, dep.id
FROM module ta CROSS JOIN module dep
WHERE ta.key = 'ta' AND dep.key IN ('identity', 'employee-directory', 'attendance')
ON CONFLICT DO NOTHING;

INSERT INTO organization_module (organization_id, module_id, status, enabled_at)
SELECT o.id, m.id, 'enabled', now()
FROM organization o CROSS JOIN module m
WHERE m.key = 'ta'
ON CONFLICT (organization_id, module_id) DO NOTHING;

CREATE TABLE ta_assignment (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL REFERENCES organization(id),
  employee_id uuid NOT NULL,
  department_id uuid NOT NULL,
  ta_month date NOT NULL CHECK (ta_month = date_trunc('month', ta_month)::date),
  daily_amount_paise bigint NOT NULL CHECK (daily_amount_paise > 0),
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
  FOREIGN KEY (organization_id, department_id) REFERENCES department(organization_id, id),
  CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CHECK (effective_from >= ta_month AND effective_from < ta_month + interval '1 month'),
  CHECK (effective_to IS NULL OR (effective_to >= ta_month AND effective_to < ta_month + interval '1 month'))
);
ALTER TABLE ta_assignment ADD CONSTRAINT uq_ta_assignment_org_id UNIQUE (organization_id, id);
CREATE INDEX ta_assignment_org_month_idx ON ta_assignment(organization_id, ta_month, status);
CREATE INDEX ta_assignment_org_employee_idx ON ta_assignment(organization_id, employee_id, ta_month, status);

CREATE TABLE ta_statement (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL REFERENCES organization(id),
  employee_id uuid NOT NULL,
  assignment_id uuid NOT NULL,
  ta_month date NOT NULL CHECK (ta_month = date_trunc('month', ta_month)::date),
  daily_amount_paise bigint NOT NULL CHECK (daily_amount_paise > 0),
  effective_from date NOT NULL,
  effective_to date,
  present_days numeric(8,2) NOT NULL DEFAULT 0 CHECK (present_days >= 0),
  half_days numeric(8,2) NOT NULL DEFAULT 0 CHECK (half_days >= 0),
  absent_days numeric(8,2) NOT NULL DEFAULT 0 CHECK (absent_days >= 0),
  leave_days numeric(8,2) NOT NULL DEFAULT 0 CHECK (leave_days >= 0),
  holiday_days numeric(8,2) NOT NULL DEFAULT 0 CHECK (holiday_days >= 0),
  eligible_days numeric(8,2) NOT NULL DEFAULT 0 CHECK (eligible_days >= 0),
  calculated_amount_paise bigint NOT NULL DEFAULT 0 CHECK (calculated_amount_paise >= 0),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent')),
  recalculated_at timestamptz,
  sent_at timestamptz,
  sent_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, employee_id) REFERENCES app_user(organization_id, id),
  FOREIGN KEY (organization_id, assignment_id) REFERENCES ta_assignment(organization_id, id),
  FOREIGN KEY (organization_id, sent_by) REFERENCES app_user(organization_id, id),
  UNIQUE (organization_id, employee_id, assignment_id, ta_month)
);
CREATE INDEX ta_statement_org_month_idx ON ta_statement(organization_id, ta_month, status);
CREATE INDEX ta_statement_employee_month_idx ON ta_statement(organization_id, employee_id, ta_month);

SELECT apply_tenant_rls('ta_assignment');
SELECT apply_tenant_rls('ta_statement');
GRANT SELECT, INSERT, UPDATE ON ta_assignment, ta_statement TO tapcrm_app;
REVOKE DELETE ON ta_assignment, ta_statement FROM tapcrm_app;
