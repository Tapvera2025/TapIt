-- =====================================================================
-- 0070 - Employee Onboarding & Profile Foundation (PRD §9.2 ON-1, ON-3, ON-5)
--
-- Adds:
--   1. employee_profile: personal, contact, and emergency contact details
--   2. employee_qualification: education & degrees
--   3. employee_skill: competencies & skills
--   4. lifecycle_template: configurable workflow templates
--   5. lifecycle_template_step: configurable steps within a template
--   6. onboarding_workflow: active onboarding workflow for an employee
--   7. onboarding_step: specific checklist steps with owner & due date
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Employee Profile (Personal Information)
-- ---------------------------------------------------------------------
CREATE TABLE employee_profile (
  organization_id          uuid NOT NULL REFERENCES organization(id),
  user_id                  uuid NOT NULL,
  phone                    text,
  date_of_birth            date,
  gender                   text,
  address_line1            text,
  address_line2            text,
  city                     text,
  state                    text,
  postal_code              text,
  emergency_contact_name   text,
  emergency_contact_phone  text,
  emergency_contact_relation text,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id),
  FOREIGN KEY (organization_id, user_id)
    REFERENCES app_user (organization_id, id) ON DELETE CASCADE
);

SELECT apply_tenant_rls('employee_profile');

CREATE TRIGGER employee_profile_updated_at
  BEFORE UPDATE ON employee_profile
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------
-- 2. Employee Qualification (Education)
-- ---------------------------------------------------------------------
CREATE TABLE employee_qualification (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL REFERENCES organization(id),
  user_id         uuid NOT NULL,
  institution     text NOT NULL,
  degree          text NOT NULL,
  field_of_study  text,
  passing_year    integer CHECK (passing_year BETWEEN 1950 AND 2100),
  grade           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, user_id)
    REFERENCES app_user (organization_id, id) ON DELETE CASCADE
);

SELECT apply_tenant_rls('employee_qualification');

CREATE INDEX ix_employee_qual_user ON employee_qualification (organization_id, user_id);

-- ---------------------------------------------------------------------
-- 3. Employee Skill
-- ---------------------------------------------------------------------
CREATE TABLE employee_skill (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL REFERENCES organization(id),
  user_id         uuid NOT NULL,
  skill_name      text NOT NULL,
  proficiency     text CHECK (proficiency IN ('beginner', 'intermediate', 'advanced', 'expert')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, user_id, skill_name),
  FOREIGN KEY (organization_id, user_id)
    REFERENCES app_user (organization_id, id) ON DELETE CASCADE
);

SELECT apply_tenant_rls('employee_skill');

CREATE INDEX ix_employee_skill_user ON employee_skill (organization_id, user_id);

-- ---------------------------------------------------------------------
-- 4. Lifecycle Template (Configurable Templates - ON-1)
-- ---------------------------------------------------------------------
CREATE TABLE lifecycle_template (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL REFERENCES organization(id),
  type            text NOT NULL CHECK (type IN ('onboarding', 'offboarding')),
  name            text NOT NULL CHECK (length(trim(name)) > 0),
  is_default      boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, type, name)
);

SELECT apply_tenant_rls('lifecycle_template');

CREATE TRIGGER lifecycle_template_updated_at
  BEFORE UPDATE ON lifecycle_template
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------
-- 5. Lifecycle Template Step
-- ---------------------------------------------------------------------
CREATE TABLE lifecycle_template_step (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id  uuid NOT NULL REFERENCES organization(id),
  template_id      uuid NOT NULL,
  code             text NOT NULL CHECK (length(trim(code)) > 0),
  title            text NOT NULL CHECK (length(trim(title)) > 0),
  description      text,
  owner_role       text NOT NULL DEFAULT 'hr' CHECK (owner_role IN ('hr', 'it', 'manager', 'facilities', 'finance')),
  days_due_offset  integer NOT NULL DEFAULT 7 CHECK (days_due_offset >= 0),
  step_order       integer NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, template_id, code),
  FOREIGN KEY (organization_id, template_id)
    REFERENCES lifecycle_template (organization_id, id) ON DELETE CASCADE
);

SELECT apply_tenant_rls('lifecycle_template_step');

CREATE INDEX ix_template_step_order ON lifecycle_template_step (organization_id, template_id, step_order);

-- ---------------------------------------------------------------------
-- 6. Onboarding Workflow (Employee Lifecycle Instance - ON-1, ON-3)
-- ---------------------------------------------------------------------
CREATE TABLE onboarding_workflow (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL REFERENCES organization(id),
  employee_id     uuid NOT NULL,
  template_id     uuid,
  status          text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed', 'cancelled')),
  started_at      timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz,
  created_by      uuid NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, employee_id)
    REFERENCES app_user (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, created_by)
    REFERENCES app_user (organization_id, id)
);

SELECT apply_tenant_rls('onboarding_workflow');

CREATE TRIGGER onboarding_workflow_updated_at
  BEFORE UPDATE ON onboarding_workflow
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX ix_onboarding_employee ON onboarding_workflow (organization_id, employee_id);
CREATE INDEX ix_onboarding_status ON onboarding_workflow (organization_id, status);

-- ---------------------------------------------------------------------
-- 7. Onboarding Step (Checklist Item - ON-5)
-- ---------------------------------------------------------------------
CREATE TABLE onboarding_step (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL REFERENCES organization(id),
  workflow_id     uuid NOT NULL,
  code            text NOT NULL,
  title           text NOT NULL,
  description     text,
  owner_id        uuid,
  owner_role      text NOT NULL DEFAULT 'hr',
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'skipped')),
  due_date        date NOT NULL,
  completed_at    timestamptz,
  completed_by    uuid,
  notes           text,
  step_order      integer NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, workflow_id, code),
  FOREIGN KEY (organization_id, workflow_id)
    REFERENCES onboarding_workflow (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, owner_id)
    REFERENCES app_user (organization_id, id),
  FOREIGN KEY (organization_id, completed_by)
    REFERENCES app_user (organization_id, id)
);

SELECT apply_tenant_rls('onboarding_step');

CREATE TRIGGER onboarding_step_updated_at
  BEFORE UPDATE ON onboarding_step
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX ix_onboarding_step_wf ON onboarding_step (organization_id, workflow_id, step_order);
CREATE INDEX ix_onboarding_step_owner_due ON onboarding_step (organization_id, owner_id, due_date) WHERE status = 'pending';
