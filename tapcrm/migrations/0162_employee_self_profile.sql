-- =====================================================================
-- 0162 — Employee self-service profile
--
-- HR now enters only the details an employee cannot give themselves
-- (name, work email, phone, placement, shift, joining date). After setting
-- a password the employee completes the rest: personal details, address,
-- emergency contact, education, work experience, skills and documents.
--
-- Adds:
--   1. employee_profile.has_no_prior_experience — the employee's own answer
--      to "is this your first job?". A fresher has no previous employer, so
--      payslips and an experience letter are not asked of them, and their
--      work-experience section counts as complete without any entries.
--   2. employee_experience — previous employment, entered by the employee.
-- =====================================================================

ALTER TABLE employee_profile
  ADD COLUMN IF NOT EXISTS has_no_prior_experience boolean NOT NULL DEFAULT false;

CREATE TABLE employee_experience (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL REFERENCES organization(id),
  user_id         uuid NOT NULL,
  company_name    text NOT NULL CHECK (length(trim(company_name)) > 0),
  job_title       text NOT NULL CHECK (length(trim(job_title)) > 0),
  start_date      date NOT NULL,
  -- NULL while the person still works there (only possible for one entry
  -- in practice, but nothing here depends on that).
  end_date        date,
  description     text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  CHECK (end_date IS NULL OR end_date >= start_date),
  FOREIGN KEY (organization_id, user_id)
    REFERENCES app_user (organization_id, id) ON DELETE CASCADE
);

SELECT apply_tenant_rls('employee_experience');

CREATE TRIGGER employee_experience_updated_at
  BEFORE UPDATE ON employee_experience
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX ix_employee_experience_user ON employee_experience (organization_id, user_id);
