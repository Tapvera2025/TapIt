-- =====================================================================
-- 0035 — Recruitment (People / HR Domain Foundation)
--
-- Job Requisition, Candidate, Interview, Interview Interviewer panel,
-- Interview Feedback, Job Offer, and Candidate Joining tables.
-- Tenant RLS, foreign keys, constraints, triggers, and indexes.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Job Requisitions
-- ---------------------------------------------------------------------
CREATE TABLE job_requisition (
  id                  uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id     uuid NOT NULL REFERENCES organization(id),
  requisition_number  text NOT NULL,
  title               text NOT NULL,
  department_id       uuid NOT NULL,
  position_id         uuid,
  openings_count      integer NOT NULL DEFAULT 1 CHECK (openings_count > 0),
  employment_type     text NOT NULL DEFAULT 'full_time'
                        CHECK (employment_type IN ('full_time', 'part_time', 'contract', 'internship')),
  location            text,
  description         text,
  requirements        text,
  status              text NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft', 'open', 'on_hold', 'filled', 'closed', 'cancelled')),
  target_hire_date    date,
  closed_at           timestamptz,
  created_by          uuid NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, requisition_number),
  FOREIGN KEY (organization_id, department_id) REFERENCES department (organization_id, id),
  FOREIGN KEY (organization_id, position_id) REFERENCES position (organization_id, id),
  FOREIGN KEY (organization_id, created_by) REFERENCES app_user (organization_id, id)
);

-- ---------------------------------------------------------------------
-- 2. Candidates
-- ---------------------------------------------------------------------
CREATE TABLE candidate (
  id                uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id   uuid NOT NULL REFERENCES organization(id),
  requisition_id    uuid NOT NULL,
  first_name        text NOT NULL,
  last_name         text NOT NULL,
  email             citext NOT NULL,
  phone             text,
  resume_url        text,
  source            text NOT NULL DEFAULT 'direct'
                      CHECK (source IN ('direct', 'referral', 'career_site', 'job_board', 'agency', 'linkedin', 'internal', 'other')),
  status            text NOT NULL DEFAULT 'applied'
                      CHECK (status IN ('applied', 'screening', 'interview', 'selected', 'rejected', 'withdrawn')),
  screening_notes   text,
  rejection_reason  text,
  created_by        uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, requisition_id, email),
  FOREIGN KEY (organization_id, requisition_id) REFERENCES job_requisition (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, created_by) REFERENCES app_user (organization_id, id)
);

-- ---------------------------------------------------------------------
-- 3. Interviews
-- ---------------------------------------------------------------------
CREATE TABLE interview (
  id                uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id   uuid NOT NULL REFERENCES organization(id),
  candidate_id      uuid NOT NULL,
  requisition_id    uuid NOT NULL,
  stage             text NOT NULL DEFAULT 'technical'
                      CHECK (stage IN ('screening', 'technical', 'managerial', 'hr', 'final')),
  round             integer NOT NULL DEFAULT 1 CHECK (round > 0),
  interview_type    text NOT NULL DEFAULT 'video'
                      CHECK (interview_type IN ('in_person', 'video', 'phone')),
  scheduled_at      timestamptz NOT NULL,
  duration_minutes  integer NOT NULL DEFAULT 60 CHECK (duration_minutes > 0),
  location_or_link  text,
  status            text NOT NULL DEFAULT 'scheduled'
                      CHECK (status IN ('scheduled', 'completed', 'cancelled', 'rescheduled', 'no_show')),
  notes             text,
  created_by        uuid NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, candidate_id) REFERENCES candidate (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, requisition_id) REFERENCES job_requisition (organization_id, id),
  FOREIGN KEY (organization_id, created_by) REFERENCES app_user (organization_id, id)
);

-- ---------------------------------------------------------------------
-- 4. Interview Interviewers (Panel references)
-- ---------------------------------------------------------------------
CREATE TABLE interview_interviewer (
  organization_id  uuid NOT NULL REFERENCES organization(id),
  interview_id     uuid NOT NULL,
  user_id          uuid NOT NULL,
  assigned_at      timestamptz NOT NULL DEFAULT now(),
  assigned_by      uuid NOT NULL,
  PRIMARY KEY (organization_id, interview_id, user_id),
  FOREIGN KEY (organization_id, interview_id) REFERENCES interview (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, user_id) REFERENCES app_user (organization_id, id),
  FOREIGN KEY (organization_id, assigned_by) REFERENCES app_user (organization_id, id)
);

-- ---------------------------------------------------------------------
-- 5. Interview Feedback
-- ---------------------------------------------------------------------
CREATE TABLE interview_feedback (
  id                     uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id        uuid NOT NULL REFERENCES organization(id),
  interview_id           uuid NOT NULL,
  interviewer_id         uuid NOT NULL,
  recommendation         text NOT NULL
                           CHECK (recommendation IN ('strong_hire', 'hire', 'no_hire', 'strong_no_hire', 'hold')),
  rating                 integer CHECK (rating BETWEEN 1 AND 5),
  feedback               text NOT NULL,
  strengths              text,
  areas_for_improvement  text,
  submitted_at           timestamptz NOT NULL DEFAULT now(),
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, interview_id, interviewer_id),
  FOREIGN KEY (organization_id, interview_id) REFERENCES interview (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, interviewer_id) REFERENCES app_user (organization_id, id)
);

-- ---------------------------------------------------------------------
-- 6. Job Offers
-- ---------------------------------------------------------------------
CREATE TABLE job_offer (
  id                     uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id        uuid NOT NULL REFERENCES organization(id),
  candidate_id           uuid NOT NULL,
  requisition_id         uuid NOT NULL,
  position_id            uuid,
  designation_id         uuid,
  offered_salary         numeric(18, 2) NOT NULL CHECK (offered_salary >= 0),
  currency               text NOT NULL DEFAULT 'INR',
  offer_date             date NOT NULL DEFAULT CURRENT_DATE,
  valid_until            date,
  expected_joining_date  date,
  status                 text NOT NULL DEFAULT 'draft'
                           CHECK (status IN ('draft', 'sent', 'accepted', 'rejected', 'expired', 'withdrawn')),
  notes                  text,
  created_by             uuid NOT NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, candidate_id) REFERENCES candidate (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, requisition_id) REFERENCES job_requisition (organization_id, id),
  FOREIGN KEY (organization_id, position_id) REFERENCES position (organization_id, id),
  FOREIGN KEY (organization_id, designation_id) REFERENCES designation (organization_id, id),
  FOREIGN KEY (organization_id, created_by) REFERENCES app_user (organization_id, id)
);

-- ---------------------------------------------------------------------
-- 7. Candidate Joining
-- ---------------------------------------------------------------------
CREATE TABLE candidate_joining (
  id                     uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id        uuid NOT NULL REFERENCES organization(id),
  candidate_id           uuid NOT NULL,
  offer_id               uuid NOT NULL,
  expected_joining_date  date NOT NULL,
  actual_joining_date    date,
  status                 text NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending', 'confirmed', 'joined', 'cancelled')),
  employee_id            uuid,
  notes                  text,
  created_by             uuid NOT NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, candidate_id),
  UNIQUE (organization_id, offer_id),
  FOREIGN KEY (organization_id, candidate_id) REFERENCES candidate (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, offer_id) REFERENCES job_offer (organization_id, id),
  FOREIGN KEY (organization_id, employee_id) REFERENCES app_user (organization_id, id),
  FOREIGN KEY (organization_id, created_by) REFERENCES app_user (organization_id, id)
);

-- ---------------------------------------------------------------------
-- Tenant RLS (TN-2, PG-4, CI-33)
-- ---------------------------------------------------------------------
SELECT apply_tenant_rls('job_requisition');
SELECT apply_tenant_rls('candidate');
SELECT apply_tenant_rls('interview');
SELECT apply_tenant_rls('interview_interviewer');
SELECT apply_tenant_rls('interview_feedback');
SELECT apply_tenant_rls('job_offer');
SELECT apply_tenant_rls('candidate_joining');

-- ---------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------
CREATE TRIGGER trg_job_requisition_updated BEFORE UPDATE ON job_requisition
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_candidate_updated BEFORE UPDATE ON candidate
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_interview_updated BEFORE UPDATE ON interview
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_interview_feedback_updated BEFORE UPDATE ON interview_feedback
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_job_offer_updated BEFORE UPDATE ON job_offer
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_candidate_joining_updated BEFORE UPDATE ON candidate_joining
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON job_requisition TO tapcrm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON candidate TO tapcrm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON interview TO tapcrm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON interview_interviewer TO tapcrm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON interview_feedback TO tapcrm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON job_offer TO tapcrm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON candidate_joining TO tapcrm_app;

-- ---------------------------------------------------------------------
-- Indexes (TECH.md IX-1: leading with organization_id)
-- ---------------------------------------------------------------------
CREATE INDEX ix_job_requisition_org_status     ON job_requisition (organization_id, status);
CREATE INDEX ix_job_requisition_org_dept       ON job_requisition (organization_id, department_id);
CREATE INDEX ix_job_requisition_org_pos        ON job_requisition (organization_id, position_id) WHERE position_id IS NOT NULL;
CREATE INDEX ix_job_requisition_org_created_by ON job_requisition (organization_id, created_by);

CREATE INDEX ix_candidate_org_requisition      ON candidate (organization_id, requisition_id);
CREATE INDEX ix_candidate_org_status           ON candidate (organization_id, status);
CREATE INDEX ix_candidate_org_email            ON candidate (organization_id, email);

CREATE INDEX ix_interview_org_candidate        ON interview (organization_id, candidate_id);
CREATE INDEX ix_interview_org_requisition      ON interview (organization_id, requisition_id);
CREATE INDEX ix_interview_org_scheduled        ON interview (organization_id, scheduled_at);
CREATE INDEX ix_interview_org_status           ON interview (organization_id, status);

CREATE INDEX ix_interview_interviewer_user     ON interview_interviewer (organization_id, user_id);
CREATE INDEX ix_interview_interviewer_int      ON interview_interviewer (organization_id, interview_id);

CREATE INDEX ix_interview_feedback_interview   ON interview_feedback (organization_id, interview_id);
CREATE INDEX ix_interview_feedback_interviewer ON interview_feedback (organization_id, interviewer_id);

CREATE INDEX ix_job_offer_org_candidate        ON job_offer (organization_id, candidate_id);
CREATE INDEX ix_job_offer_org_requisition      ON job_offer (organization_id, requisition_id);
CREATE INDEX ix_job_offer_org_status           ON job_offer (organization_id, status);

CREATE INDEX ix_candidate_joining_candidate    ON candidate_joining (organization_id, candidate_id);
CREATE INDEX ix_candidate_joining_offer        ON candidate_joining (organization_id, offer_id);
CREATE INDEX ix_candidate_joining_status       ON candidate_joining (organization_id, status);
CREATE INDEX ix_candidate_joining_employee     ON candidate_joining (organization_id, employee_id) WHERE employee_id IS NOT NULL;
