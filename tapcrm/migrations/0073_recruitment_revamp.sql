-- =====================================================================
-- 0070 — Recruitment Module Revamp
--
-- Adds the round-based interview pipeline, candidate activity timeline,
-- joining email templates, and acknowledgement tracking.
--
-- New tables:
--   recruitment_pipeline_round    — ordered interview rounds per job post
--   recruitment_candidate_round   — candidate progress through each round
--   recruitment_candidate_event   — full activity timeline per candidate
--   recruitment_email_template    — reusable joining email templates
--
-- Existing table changes:
--   candidate_joining             — acknowledgement fields added
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Pipeline Rounds (per job post / requisition)
-- ---------------------------------------------------------------------
CREATE TABLE recruitment_pipeline_round (
  id                  uuid        PRIMARY KEY DEFAULT uuidv7(),
  organization_id     uuid        NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  requisition_id      uuid        NOT NULL,
  name                text        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
  mode                text        NOT NULL DEFAULT 'online'
                                    CHECK (mode IN ('online', 'offline', 'phone')),
  order_index         integer     NOT NULL DEFAULT 0,
  interviewer_note    text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, requisition_id)
    REFERENCES job_requisition (organization_id, id) ON DELETE CASCADE
);

CREATE TRIGGER trg_recruitment_pipeline_round_updated
  BEFORE UPDATE ON recruitment_pipeline_round
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

SELECT apply_tenant_rls('recruitment_pipeline_round');
GRANT SELECT, INSERT, UPDATE, DELETE ON recruitment_pipeline_round TO tapcrm_app;

CREATE INDEX ix_pipeline_round_org_req
  ON recruitment_pipeline_round (organization_id, requisition_id, order_index);

-- ---------------------------------------------------------------------
-- 2. Candidate Round Progress
-- ---------------------------------------------------------------------
CREATE TABLE recruitment_candidate_round (
  id                 uuid        PRIMARY KEY DEFAULT uuidv7(),
  organization_id    uuid        NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  candidate_id       uuid        NOT NULL,
  pipeline_round_id  uuid        NOT NULL,
  assigned_to        uuid,
  scheduled_at       timestamptz,
  mode               text        CHECK (mode IN ('online', 'offline', 'phone')),
  meeting_link       text,
  location           text,
  status             text        NOT NULL DEFAULT 'pending'
                                   CHECK (status IN ('pending','scheduled','completed','passed','failed','skipped')),
  interviewer_notes  text,
  rating             integer     CHECK (rating BETWEEN 1 AND 5),
  recommendation     text        CHECK (recommendation IN ('pass','fail','hold')),
  passed_at          timestamptz,
  failed_at          timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, candidate_id, pipeline_round_id),
  FOREIGN KEY (organization_id, candidate_id)
    REFERENCES candidate (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, pipeline_round_id)
    REFERENCES recruitment_pipeline_round (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, assigned_to)
    REFERENCES app_user (organization_id, id) ON DELETE SET NULL
);

CREATE TRIGGER trg_recruitment_candidate_round_updated
  BEFORE UPDATE ON recruitment_candidate_round
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

SELECT apply_tenant_rls('recruitment_candidate_round');
GRANT SELECT, INSERT, UPDATE, DELETE ON recruitment_candidate_round TO tapcrm_app;

CREATE INDEX ix_candidate_round_org_candidate
  ON recruitment_candidate_round (organization_id, candidate_id);
CREATE INDEX ix_candidate_round_assigned_to
  ON recruitment_candidate_round (organization_id, assigned_to)
  WHERE assigned_to IS NOT NULL;
CREATE INDEX ix_candidate_round_status
  ON recruitment_candidate_round (organization_id, status);

-- ---------------------------------------------------------------------
-- 3. Candidate Activity Timeline
-- ---------------------------------------------------------------------
CREATE TABLE recruitment_candidate_event (
  id               uuid        PRIMARY KEY DEFAULT uuidv7(),
  organization_id  uuid        NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  candidate_id     uuid        NOT NULL,
  event_type       text        NOT NULL
                                 CHECK (event_type IN (
                                   'applied',
                                   'screening_passed',
                                   'round_passed',
                                   'round_failed',
                                   'round_scheduled',
                                   'interviewer_assigned',
                                   'feedback_submitted',
                                   'selected',
                                   'rejected',
                                   'offer_sent',
                                   'offer_accepted',
                                   'joining_email_sent',
                                   'acknowledged',
                                   'employee_imported'
                                 )),
  actor_id         uuid,
  metadata         jsonb,
  occurred_at      timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, candidate_id)
    REFERENCES candidate (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, actor_id)
    REFERENCES app_user (organization_id, id) ON DELETE SET NULL
);

SELECT apply_tenant_rls('recruitment_candidate_event');
GRANT SELECT, INSERT, UPDATE, DELETE ON recruitment_candidate_event TO tapcrm_app;

CREATE INDEX ix_candidate_event_org_candidate
  ON recruitment_candidate_event (organization_id, candidate_id, occurred_at DESC);

-- ---------------------------------------------------------------------
-- 4. Joining Email Templates
-- ---------------------------------------------------------------------
CREATE TABLE recruitment_email_template (
  id               uuid        PRIMARY KEY DEFAULT uuidv7(),
  organization_id  uuid        NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  name             text        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
  subject          text        NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 255),
  body             text        NOT NULL,
  is_default       boolean     NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id)
);

CREATE TRIGGER trg_recruitment_email_template_updated
  BEFORE UPDATE ON recruitment_email_template
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

SELECT apply_tenant_rls('recruitment_email_template');
GRANT SELECT, INSERT, UPDATE, DELETE ON recruitment_email_template TO tapcrm_app;

CREATE INDEX ix_email_template_org
  ON recruitment_email_template (organization_id);

-- Ensure at most one default template per org
CREATE UNIQUE INDEX ix_email_template_org_default
  ON recruitment_email_template (organization_id)
  WHERE is_default = true;

-- ---------------------------------------------------------------------
-- 5. Acknowledgement fields on candidate_joining
-- ---------------------------------------------------------------------
ALTER TABLE candidate_joining
  ADD COLUMN joining_email_sent_at     timestamptz,
  ADD COLUMN joining_email_template_id uuid,
  ADD COLUMN acknowledge_token         text UNIQUE,
  ADD COLUMN acknowledged_at           timestamptz,
  ADD COLUMN acknowledge_ip            text;

ALTER TABLE candidate_joining
  ADD CONSTRAINT fk_joining_email_template
    FOREIGN KEY (organization_id, joining_email_template_id)
    REFERENCES recruitment_email_template (organization_id, id)
    ON DELETE SET NULL;

CREATE INDEX ix_candidate_joining_acknowledge_token
  ON candidate_joining (acknowledge_token)
  WHERE acknowledge_token IS NOT NULL;

-- ---------------------------------------------------------------------
-- 6. New registry actions for round management and interviewer panel
-- ---------------------------------------------------------------------
INSERT INTO registry_action (
  action, module, resource, domain, sensitive, approval_bearing, initiator_field,
  position_grantable, delegation_allowed, super_admin_only, description
)
VALUES
  ('recruitment:manage-pipeline', 'recruitment', 'jobRequisition', 'business',
    false, false, NULL, true, true, false,
    'Create and manage interview pipeline rounds for job posts'),
  ('recruitment:manage-candidate-rounds', 'recruitment', 'candidate', 'business',
    false, false, NULL, true, true, false,
    'Assign interviewers, pass/fail candidates through rounds'),
  ('recruitment:submit-round-feedback', 'recruitment', 'candidate', 'business',
    false, false, NULL, true, true, false,
    'Submit interview feedback as an assigned interviewer'),
  ('recruitment:view-candidate-events', 'recruitment', 'candidate', 'business',
    false, false, NULL, true, true, false,
    'View candidate activity timeline'),
  ('recruitment:manage-email-templates', 'recruitment', NULL, 'business',
    false, false, NULL, true, true, false,
    'Create and manage joining email templates'),
  ('recruitment:send-joining-email', 'recruitment', 'candidateJoining', 'business',
    false, false, NULL, true, true, false,
    'Send the joining confirmation email to an accepted candidate')
ON CONFLICT (action) DO UPDATE SET
  module = EXCLUDED.module,
  resource = EXCLUDED.resource,
  domain = EXCLUDED.domain,
  description = EXCLUDED.description;

-- Grant new HR actions to hr and hr-executive positions
INSERT INTO position_policy (organization_id, position_id, action, allowed, scope)
SELECT p.organization_id, p.id, actions.action, true, 'department'
FROM position p
CROSS JOIN (
  VALUES
    ('recruitment:manage-pipeline'::text),
    ('recruitment:manage-candidate-rounds'::text),
    ('recruitment:view-candidate-events'::text),
    ('recruitment:manage-email-templates'::text),
    ('recruitment:send-joining-email'::text)
) AS actions(action)
WHERE p.code IN ('hr', 'hr-executive')
  AND p.status = 'active'
ON CONFLICT (organization_id, position_id, action) DO NOTHING;

-- Grant feedback submission to all employee positions (participant-scoped)
INSERT INTO position_policy (organization_id, position_id, action, allowed, scope)
SELECT p.organization_id, p.id, 'recruitment:submit-round-feedback', true, 'participant'
FROM position p
WHERE p.status = 'active'
  AND p.code NOT IN ('hr', 'hr-executive')
ON CONFLICT (organization_id, position_id, action) DO NOTHING;

-- ---------------------------------------------------------------------
-- 7. Public resolver for acknowledge token
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION resolve_joining_acknowledge_token(p_token text)
RETURNS TABLE (
  id                          uuid,
  organization_id             uuid,
  candidate_id                uuid,
  offer_id                    uuid,
  expected_joining_date       date,
  actual_joining_date         date,
  status                      text,
  employee_id                 uuid,
  notes                       text,
  joining_email_sent_at       timestamptz,
  joining_email_template_id   uuid,
  acknowledge_token           text,
  acknowledged_at             timestamptz,
  acknowledge_ip              text,
  created_by                  uuid,
  created_at                  timestamptz,
  updated_at                  timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, organization_id, candidate_id, offer_id,
         expected_joining_date, actual_joining_date, status, employee_id, notes,
         joining_email_sent_at, joining_email_template_id,
         acknowledge_token, acknowledged_at, acknowledge_ip,
         created_by, created_at, updated_at
  FROM candidate_joining
  WHERE acknowledge_token = p_token;
$$;

GRANT EXECUTE ON FUNCTION resolve_joining_acknowledge_token(text) TO tapcrm_app;
