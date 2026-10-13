-- Employee penalties. Payroll consumption is intentionally deferred.
INSERT INTO module (key, name, description, is_core)
VALUES ('penalties', 'Penalties', 'Employee penalties recorded for future payroll deduction', false)
ON CONFLICT (key) DO NOTHING;

INSERT INTO module_dependency (module_id, depends_on_module_id)
SELECT m.id, d.id
FROM module m CROSS JOIN module d
WHERE m.key = 'penalties' AND d.key = 'employee-directory'
ON CONFLICT DO NOTHING;

CREATE TABLE employee_penalty (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL REFERENCES organization(id),
  employee_id     uuid NOT NULL,
  penalty_type    text NOT NULL CHECK (penalty_type IN (
    'late_arrival', 'early_departure', 'unapproved_absence',
    'attendance_violation', 'policy_violation', 'misconduct',
    'asset_damage_or_loss', 'other'
  )),
  amount_paise    bigint NOT NULL CHECK (amount_paise > 0),
  penalty_date    date NOT NULL,
  payroll_period  date NOT NULL CHECK (payroll_period = date_trunc('month', payroll_period)::date),
  remarks         text NOT NULL CHECK (char_length(btrim(remarks)) > 0),
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
  payroll_status  text NOT NULL DEFAULT 'pending' CHECK (payroll_status IN ('pending', 'processed', 'recovered')),
  cancellation_reason text,
  cancelled_at    timestamptz,
  cancelled_by    uuid,
  created_by      uuid NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, employee_id) REFERENCES app_user(organization_id, id),
  FOREIGN KEY (organization_id, cancelled_by) REFERENCES app_user(organization_id, id),
  FOREIGN KEY (organization_id, created_by) REFERENCES app_user(organization_id, id),
  CHECK ((status = 'cancelled') = (cancellation_reason IS NOT NULL AND cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL))
);

CREATE INDEX employee_penalty_org_employee_idx ON employee_penalty (organization_id, employee_id, penalty_date DESC);
CREATE INDEX employee_penalty_org_period_idx ON employee_penalty (organization_id, payroll_period, status);
CREATE INDEX employee_penalty_org_type_idx ON employee_penalty (organization_id, penalty_type, status);

SELECT apply_tenant_rls('employee_penalty');
GRANT SELECT, INSERT, UPDATE ON employee_penalty TO tapcrm_app;
REVOKE DELETE ON employee_penalty FROM tapcrm_app;

INSERT INTO registry_action (
  action, module, resource, domain, sensitive, approval_bearing, initiator_field,
  position_grantable, delegation_allowed, super_admin_only, description
)
VALUES
  ('penalty:view-own', 'penalties', 'employeePenalty', 'people', false, false, NULL, true, true, false, 'See penalties recorded against the caller.'),
  ('penalty:view', 'penalties', 'employeePenalty', 'people', false, false, NULL, true, true, false, 'See employee penalties within the caller scope.'),
  ('penalty:manage', 'penalties', 'employeePenalty', 'people', true, false, NULL, true, false, false, 'Create and cancel employee penalties.')
ON CONFLICT (action) DO UPDATE SET
  module = EXCLUDED.module,
  resource = EXCLUDED.resource,
  domain = EXCLUDED.domain,
  sensitive = EXCLUDED.sensitive,
  approval_bearing = EXCLUDED.approval_bearing,
  initiator_field = EXCLUDED.initiator_field,
  position_grantable = EXCLUDED.position_grantable,
  delegation_allowed = EXCLUDED.delegation_allowed,
  super_admin_only = EXCLUDED.super_admin_only,
  description = EXCLUDED.description;

INSERT INTO organization_module (organization_id, module_id, status, enabled_at)
SELECT o.id, m.id, 'enabled', now()
FROM organization o JOIN module m ON m.key = 'penalties'
ON CONFLICT (organization_id, module_id) DO UPDATE
SET status = 'enabled', enabled_at = COALESCE(organization_module.enabled_at, now());

-- Existing organizations receive self-service visibility for every active
-- position, while HR positions receive the management scope.
INSERT INTO position_policy (organization_id, position_id, action, allowed, scope)
SELECT p.organization_id, p.id, 'penalty:view-own', true, 'own'
FROM position p
WHERE p.status = 'active'
ON CONFLICT (organization_id, position_id, action) DO NOTHING;

INSERT INTO position_policy (organization_id, position_id, action, allowed, scope)
SELECT p.organization_id, p.id, permissions.action, true, 'all-people'
FROM position p
CROSS JOIN (VALUES ('penalty:view'), ('penalty:manage')) AS permissions(action)
WHERE p.code IN ('hr', 'hr-executive') AND p.status = 'active'
ON CONFLICT (organization_id, position_id, action) DO NOTHING;
