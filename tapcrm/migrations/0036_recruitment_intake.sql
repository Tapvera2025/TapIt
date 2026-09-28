-- =====================================================================
-- 0036 — Recruitment Intake (Application Links & Resume Submissions)
--
-- Dedicated resume-intake layer before candidate creation:
-- 1. recruitment_application_link (secure student application links)
-- 2. candidate_resume_submission (HR resume inbox & student submissions)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Recruitment Application Links
-- ---------------------------------------------------------------------
CREATE TABLE recruitment_application_link (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id  uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  requisition_id   uuid NOT NULL,
  token            text NOT NULL UNIQUE,
  status           text NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active', 'disabled', 'expired')),
  expires_at       timestamptz,
  created_by       uuid NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, requisition_id) REFERENCES job_requisition (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, created_by) REFERENCES app_user (organization_id, id)
);

CREATE TRIGGER trg_recruitment_application_link_updated BEFORE UPDATE ON recruitment_application_link
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Token-resolved intake table: un-gated by tenant RLS for public pre-auth resolution,
-- identical to admin_invitation pattern. All HR queries enforce organization_id.
GRANT SELECT, INSERT, UPDATE, DELETE ON recruitment_application_link TO tapcrm_app;

CREATE INDEX ix_recruitment_application_link_token ON recruitment_application_link (token);
CREATE INDEX ix_recruitment_application_link_org_req ON recruitment_application_link (organization_id, requisition_id);
CREATE INDEX ix_recruitment_application_link_org_status ON recruitment_application_link (organization_id, status);

-- ---------------------------------------------------------------------
-- 2. Candidate Resume Submissions
-- ---------------------------------------------------------------------
CREATE TABLE candidate_resume_submission (
  id                   uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id      uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  requisition_id       uuid NOT NULL,
  application_link_id  uuid,
  first_name           text NOT NULL,
  last_name            text NOT NULL,
  email                citext NOT NULL,
  phone                text,
  resume_object_key    text NOT NULL,
  resume_filename      text NOT NULL,
  resume_mime_type     text NOT NULL DEFAULT 'application/pdf',
  resume_file_size     integer NOT NULL DEFAULT 0,
  parsed_data          jsonb NOT NULL DEFAULT '{}'::jsonb,
  status               text NOT NULL DEFAULT 'submitted'
                         CHECK (status IN ('submitted', 'reviewed', 'converted', 'rejected')),
  candidate_id         uuid,
  rejection_reason     text,
  reviewed_by          uuid,
  reviewed_at          timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, requisition_id) REFERENCES job_requisition (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, application_link_id) REFERENCES recruitment_application_link (organization_id, id) ON DELETE SET NULL,
  FOREIGN KEY (organization_id, candidate_id) REFERENCES candidate (organization_id, id) ON DELETE SET NULL,
  FOREIGN KEY (organization_id, reviewed_by) REFERENCES app_user (organization_id, id)
);

CREATE TRIGGER trg_candidate_resume_submission_updated BEFORE UPDATE ON candidate_resume_submission
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

SELECT apply_tenant_rls('candidate_resume_submission');

GRANT SELECT, INSERT, UPDATE, DELETE ON candidate_resume_submission TO tapcrm_app;

CREATE INDEX ix_candidate_resume_sub_org_req ON candidate_resume_submission (organization_id, requisition_id);
CREATE INDEX ix_candidate_resume_sub_org_status ON candidate_resume_submission (organization_id, status);
CREATE INDEX ix_candidate_resume_sub_org_email ON candidate_resume_submission (organization_id, email);
CREATE INDEX ix_candidate_resume_sub_app_link ON candidate_resume_submission (organization_id, application_link_id) WHERE application_link_id IS NOT NULL;
CREATE INDEX ix_candidate_resume_sub_candidate ON candidate_resume_submission (organization_id, candidate_id) WHERE candidate_id IS NOT NULL;
