-- =====================================================================
-- 0005 — Platform module catalog and dependencies
-- =====================================================================
CREATE TABLE module (
  id           uuid PRIMARY KEY DEFAULT uuidv7(),
  key          text NOT NULL UNIQUE,
  name         text NOT NULL,
  description  text NOT NULL DEFAULT '',
  status       text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  version      text NOT NULL DEFAULT '1.0.0',
  is_core      boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE module_dependency (
  module_id              uuid NOT NULL REFERENCES module(id) ON DELETE CASCADE,
  depends_on_module_id   uuid NOT NULL REFERENCES module(id) ON DELETE RESTRICT,
  PRIMARY KEY (module_id, depends_on_module_id),
  CHECK (module_id <> depends_on_module_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON module, module_dependency TO tapcrm_app;

INSERT INTO module (key, name, description, is_core) VALUES
('identity','Identity','Authentication, sessions and account security',true),
('organization','Organization','Company structure and people organization',true),
('access-management','Access Management','Roles, permissions and delegation',true),
('audit','Audit','Access and activity audit trail',true),
('system-administration','System Administration','Tenant system configuration',true),
('employee-directory','Employee Directory','Employee profiles and directory',false),
('onboarding','Onboarding','Employee onboarding workflows',false),
('live-status','Live Status','Live employee status',false),
('attendance','Attendance','Attendance records and corrections',false),
('break-management','Break Management','Break policy and breach management',false),
('shifts','Shifts','Shift planning and requests',false),
('biometric','Biometric','Biometric device management',false),
('leave','Leave','Leave and WFH management',false),
('holidays','Holidays','Holiday calendar',false),
('payroll','Payroll','Payroll and payslips',false),
('performance','Performance','Performance management',false),
('territories','Territories','Sales territories',false),
('leads','Leads','Lead management',false),
('callbacks','Callbacks','Callback management',false),
('handovers','Handovers','Sales handovers',false),
('deals','Deals','Deal and commercial management',false),
('approvals','Approvals','Approval workflows',false),
('handoff','Handoff','Project handoff',false),
('projects','Projects','Project management',false),
('tasks','Tasks','Task management',false),
('resource-planning','Resource Planning','Resource allocation',false),
('delivery','Delivery','Delivery management',false),
('clients','Clients','Client management',false),
('post-closure','Post Closure','Post-closure workflows',false),
('client-portal','Client Portal','External client portal',false),
('billing-terms','Billing Terms','Billing terms',false),
('invoicing','Invoicing','Invoice management',false),
('payments','Payments','Payment management',false),
('receivables','Receivables','Receivables management',false),
('payables','Payables','Payables management',false),
('accounting','Accounting','Accounting workflows',false),
('chat','Chat','Internal chat',false),
('project-communication','Project Communication','Project communications',false),
('documents','Documents','Document management',false),
('reporting','Reporting','Reporting and analytics',false),
('notifications','Notifications','Notifications',false),
('workspace','Workspace','Personal workspace tools',false)
ON CONFLICT (key) DO NOTHING;

-- Foundation dependencies.
INSERT INTO module_dependency (module_id, depends_on_module_id)
SELECT m.id, d.id FROM module m JOIN module d ON d.key = 'identity'
WHERE m.key <> 'identity'
ON CONFLICT DO NOTHING;

-- Domain dependencies. The platform automatically enables these prerequisites
-- when a dependent module is selected.
INSERT INTO module_dependency (module_id, depends_on_module_id)
SELECT m.id, d.id FROM module m JOIN module d ON d.key = 'employee-directory'
WHERE m.key IN ('attendance','break-management','shifts','biometric','leave','holidays','payroll','performance')
ON CONFLICT DO NOTHING;
INSERT INTO module_dependency (module_id, depends_on_module_id)
SELECT m.id, d.id FROM module m JOIN module d ON d.key = 'clients'
WHERE m.key IN ('deals','invoicing','payments','receivables','payables','accounting')
ON CONFLICT DO NOTHING;
INSERT INTO module_dependency (module_id, depends_on_module_id)
SELECT m.id, d.id FROM module m JOIN module d ON d.key = 'projects'
WHERE m.key IN ('tasks','resource-planning','delivery','project-communication')
ON CONFLICT DO NOTHING;
