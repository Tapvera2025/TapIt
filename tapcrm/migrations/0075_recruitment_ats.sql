-- Local, evidence-based resume screening. Scores do not change hiring decisions.
CREATE TABLE recruitment_ats_criteria (
  organization_id uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  requisition_id uuid NOT NULL,
  criteria jsonb NOT NULL CHECK (jsonb_typeof(criteria) = 'object'),
  criteria_hash text NOT NULL CHECK (char_length(criteria_hash) = 64),
  updated_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, requisition_id),
  FOREIGN KEY (organization_id, requisition_id)
    REFERENCES job_requisition(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, updated_by) REFERENCES app_user(organization_id, id)
);

SELECT apply_tenant_rls('recruitment_ats_criteria');
GRANT SELECT, INSERT, UPDATE, DELETE ON recruitment_ats_criteria TO tapcrm_app;

CREATE TABLE recruitment_ats_scan (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  submission_id uuid NOT NULL,
  requisition_id uuid NOT NULL,
  criteria jsonb NOT NULL CHECK (jsonb_typeof(criteria) = 'object'),
  criteria_hash text NOT NULL CHECK (char_length(criteria_hash) = 64),
  resume_hash text NOT NULL CHECK (char_length(resume_hash) = 64),
  resume_version text NOT NULL CHECK (char_length(resume_version) = 64),
  engine_version text NOT NULL,
  evaluation jsonb NOT NULL CHECK (jsonb_typeof(evaluation) = 'object'),
  scanned_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, submission_id, resume_hash, criteria_hash, engine_version),
  FOREIGN KEY (organization_id, submission_id)
    REFERENCES candidate_resume_submission(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, requisition_id)
    REFERENCES job_requisition(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, scanned_by) REFERENCES app_user(organization_id, id)
);

SELECT apply_tenant_rls('recruitment_ats_scan');
-- Immutable reports; tenant/application code can only append and read.
GRANT SELECT, INSERT ON recruitment_ats_scan TO tapcrm_app;
CREATE INDEX ix_recruitment_ats_scan_submission
  ON recruitment_ats_scan(organization_id, submission_id, created_at DESC, id DESC);
