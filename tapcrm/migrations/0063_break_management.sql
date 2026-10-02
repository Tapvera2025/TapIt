-- =====================================================================
-- 0063 — Break management (attendance design §8, §13)
--
-- Break policies, versioned penalty rules, policy assignments,
-- breach detection, break-deduction payroll inputs, and employee
-- permission backfill. Adds the deferred FK on attendance_overlay
-- and evaluation-watermark columns on attendance_record.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Employee permission backfill (Task 0 plan)
-- Existing employee positions get breaks:view and breaks:explain at
-- own scope, seeded from whoever already has attendance:view.
-- No position_policy_template table exists in this schema.
-- ---------------------------------------------------------------------
INSERT INTO position_policy
  (organization_id, position_id, action, allowed, scope, fields, constraints)
SELECT organization_id, position_id, 'breaks:view', true, 'own', '{}', '{}'
FROM position_policy
WHERE action = 'attendance:view'
ON CONFLICT (organization_id, position_id, action) DO NOTHING;

INSERT INTO position_policy
  (organization_id, position_id, action, allowed, scope, fields, constraints)
SELECT organization_id, position_id, 'breaks:explain', true, 'own', '{}', '{}'
FROM position_policy
WHERE action = 'attendance:view'
ON CONFLICT (organization_id, position_id, action) DO NOTHING;

-- ---------------------------------------------------------------------
-- break_policy — identity record; name may be updated, never deleted
-- ---------------------------------------------------------------------
CREATE TABLE break_policy (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL REFERENCES organization(id),
  name            text NOT NULL CHECK (char_length(btrim(name)) > 0),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id)
);

-- ---------------------------------------------------------------------
-- break_policy_version — immutable, append-only versioned settings
-- ---------------------------------------------------------------------
CREATE TABLE break_policy_version (
  id                       uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id          uuid NOT NULL,
  policy_id                uuid NOT NULL,
  effective_from           date NOT NULL,
  upper_total_minutes      integer CHECK (upper_total_minutes > 0),
  upper_single_minutes     integer CHECK (upper_single_minutes > 0),
  lower_total_minutes      integer CHECK (lower_total_minutes > 0),
  lower_enforced           boolean NOT NULL DEFAULT false,
  grace_minutes            integer NOT NULL DEFAULT 0 CHECK (grace_minutes >= 0),
  warning_percent          integer NOT NULL DEFAULT 80 CHECK (warning_percent BETWEEN 1 AND 100),
  counts_toward_work_hours boolean NOT NULL DEFAULT true,
  created_at               timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, policy_id, effective_from),
  FOREIGN KEY (organization_id, policy_id) REFERENCES break_policy (organization_id, id)
);

-- ---------------------------------------------------------------------
-- break_penalty_rule — immutable, append-only; one ordinal per version
-- ---------------------------------------------------------------------
CREATE TABLE break_penalty_rule (
  id                uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id   uuid NOT NULL,
  policy_version_id uuid NOT NULL,
  ordinal           integer NOT NULL CHECK (ordinal > 0),
  condition         text NOT NULL CHECK (condition IN (
                      'over-total', 'over-single', 'under-total', 'count-over')),
  occurrence_window text NOT NULL CHECK (occurrence_window IN ('day', 'week', 'month')),
  occurrence_count  integer NOT NULL DEFAULT 1 CHECK (occurrence_count > 0),
  consequence       text NOT NULL CHECK (consequence IN (
                      'warn', 'notify-manager', 'require-explanation',
                      'mark-late', 'mark-half-day', 'mark-absent',
                      'deduct-minutes', 'deduct-amount')),
  minutes           integer CHECK (minutes > 0),
  amount            numeric(14,4) CHECK (amount > 0),
  auto_apply        boolean NOT NULL DEFAULT false,
  -- Attestation: all three present exactly when auto_apply=true
  attested_by       uuid,
  attested_month    date,
  attested_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, policy_version_id, ordinal),
  FOREIGN KEY (organization_id, policy_version_id)
    REFERENCES break_policy_version (organization_id, id),
  CHECK ((consequence = 'deduct-minutes') = (minutes IS NOT NULL)),
  CHECK ((consequence = 'deduct-amount')  = (amount  IS NOT NULL)),
  CHECK (
    (auto_apply = true
       AND attested_by IS NOT NULL
       AND attested_month IS NOT NULL
       AND attested_at IS NOT NULL)
    OR
    (auto_apply = false
       AND attested_by IS NULL
       AND attested_month IS NULL
       AND attested_at IS NULL)
  ),
  CHECK (attested_month IS NULL OR attested_month = date_trunc('month', attested_month)::date)
);
-- attested_by: nullable same-org reviewer
ALTER TABLE break_penalty_rule
  ADD CONSTRAINT fk_break_penalty_rule_attested_by
  FOREIGN KEY (organization_id, attested_by) REFERENCES app_user (organization_id, id);

-- ---------------------------------------------------------------------
-- break_policy_assignment — maps a policy to a scope (or org-wide)
-- ---------------------------------------------------------------------
CREATE TABLE break_policy_assignment (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL,
  policy_id       uuid NOT NULL,
  priority        integer NOT NULL DEFAULT 0,
  effective_from  date NOT NULL,
  effective_to    date,
  -- Exactly zero or one scoped target
  department_id   uuid,
  position_id     uuid,
  shift_id        uuid,
  team_id         uuid,
  user_id         uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, policy_id) REFERENCES break_policy (organization_id, id),
  CHECK (num_nonnulls(department_id, position_id, shift_id, team_id, user_id) <= 1),
  CHECK (effective_to IS NULL OR effective_to > effective_from)
);
ALTER TABLE break_policy_assignment
  ADD CONSTRAINT fk_bpa_department
  FOREIGN KEY (organization_id, department_id) REFERENCES department (organization_id, id);
ALTER TABLE break_policy_assignment
  ADD CONSTRAINT fk_bpa_position
  FOREIGN KEY (organization_id, position_id)   REFERENCES position (organization_id, id);
ALTER TABLE break_policy_assignment
  ADD CONSTRAINT fk_bpa_shift
  FOREIGN KEY (organization_id, shift_id)      REFERENCES shift (organization_id, id);
ALTER TABLE break_policy_assignment
  ADD CONSTRAINT fk_bpa_team
  FOREIGN KEY (organization_id, team_id)       REFERENCES team (organization_id, id);
ALTER TABLE break_policy_assignment
  ADD CONSTRAINT fk_bpa_user
  FOREIGN KEY (organization_id, user_id)       REFERENCES app_user (organization_id, id);

-- ---------------------------------------------------------------------
-- break_breach — one current answer per attendance record
-- ---------------------------------------------------------------------
CREATE TABLE break_breach (
  id                      uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id         uuid NOT NULL,
  user_id                 uuid NOT NULL,
  attendance_record_id    uuid NOT NULL,
  work_date               date NOT NULL,
  policy_version_id       uuid NOT NULL,
  matched_rule_id         uuid,
  occurrence_number       integer CHECK (occurrence_number > 0),
  -- Measured break values
  measured_total_minutes  integer NOT NULL DEFAULT 0 CHECK (measured_total_minutes >= 0),
  measured_single_minutes integer NOT NULL DEFAULT 0 CHECK (measured_single_minutes >= 0),
  measured_count          integer NOT NULL DEFAULT 0 CHECK (measured_count >= 0),
  -- Fingerprints for idempotency
  evidence_fingerprint    text NOT NULL,
  answer_fingerprint      text NOT NULL,
  -- Calculation version at evaluation time
  calculation_version     integer NOT NULL,
  -- Status
  status                  text NOT NULL DEFAULT 'pending'
                            CHECK (status IN (
                              'pending', 'confirmed', 'waived', 'advisory',
                              'suppressed', 'superseded')),
  suppression_reason      text CHECK (suppression_reason IN ('leave', 'holiday')),
  explanation             text CHECK (explanation IS NULL OR char_length(btrim(explanation)) > 0),
  decision_reason         text,
  -- Confirmation (human or auto)
  confirmed_by            uuid,
  confirmed_at            timestamptz,
  auto_applied            boolean NOT NULL DEFAULT false,
  -- Waiver
  waived_by               uuid,
  waived_at               timestamptz,
  waiver_reason           text CHECK (waiver_reason IS NULL OR char_length(btrim(waiver_reason)) > 0),
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  -- Keys
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, user_id, id),
  -- auto_applied constraints
  CHECK (
    (auto_applied = false) OR
    (auto_applied = true AND confirmed_at IS NOT NULL AND confirmed_by IS NULL
       AND status IN ('confirmed', 'waived', 'superseded'))
  ),
  -- confirmed requires confirmed_at; exactly one confirmation source
  CHECK (
    status != 'confirmed' OR
    (confirmed_at IS NOT NULL AND (
      (confirmed_by IS NOT NULL AND auto_applied = false) OR
      (confirmed_by IS NULL     AND auto_applied = true)
    ))
  ),
  -- suppressed: requires suppression_reason, NULL rule/occurrence, no auto, no actors
  CHECK (
    status != 'suppressed' OR
    (suppression_reason IS NOT NULL
       AND matched_rule_id IS NULL
       AND occurrence_number IS NULL
       AND auto_applied = false
       AND confirmed_by IS NULL
       AND confirmed_at IS NULL
       AND waived_by IS NULL
       AND waived_at IS NULL)
  ),
  -- non-suppressed/non-superseded statuses have NULL suppression_reason
  CHECK (
    status IN ('suppressed', 'superseded') OR suppression_reason IS NULL
  ),
  -- waived requires reason, actor, and time
  CHECK (
    status != 'waived' OR
    (waiver_reason IS NOT NULL AND waived_by IS NOT NULL AND waived_at IS NOT NULL)
  )
);
ALTER TABLE break_breach
  ADD CONSTRAINT fk_break_breach_user
  FOREIGN KEY (organization_id, user_id) REFERENCES app_user (organization_id, id);
ALTER TABLE break_breach
  ADD CONSTRAINT fk_break_breach_attendance_record
  FOREIGN KEY (organization_id, user_id, attendance_record_id)
  REFERENCES attendance_record (organization_id, user_id, id);
ALTER TABLE break_breach
  ADD CONSTRAINT fk_break_breach_policy_version
  FOREIGN KEY (organization_id, policy_version_id)
  REFERENCES break_policy_version (organization_id, id);
ALTER TABLE break_breach
  ADD CONSTRAINT fk_break_breach_matched_rule
  FOREIGN KEY (organization_id, matched_rule_id)
  REFERENCES break_penalty_rule (organization_id, id);
ALTER TABLE break_breach
  ADD CONSTRAINT fk_break_breach_confirmed_by
  FOREIGN KEY (organization_id, confirmed_by) REFERENCES app_user (organization_id, id);
ALTER TABLE break_breach
  ADD CONSTRAINT fk_break_breach_waived_by
  FOREIGN KEY (organization_id, waived_by) REFERENCES app_user (organization_id, id);

-- One current answer per attendance record
-- (current = pending | confirmed | waived | advisory | suppressed)
CREATE UNIQUE INDEX ix_break_breach_current_per_record
  ON break_breach (organization_id, attendance_record_id)
  WHERE status IN ('pending', 'confirmed', 'waived', 'advisory', 'suppressed');

-- No duplicate logical answers per record
CREATE UNIQUE INDEX ix_break_breach_answer_fingerprint
  ON break_breach (organization_id, attendance_record_id, answer_fingerprint)
  WHERE status IN ('pending', 'confirmed', 'waived', 'advisory', 'suppressed');

-- Evaluation scan index
CREATE INDEX ix_break_breach_by_user_date
  ON break_breach (organization_id, user_id, work_date);

-- ---------------------------------------------------------------------
-- Deferred FK: attendance_overlay → break_breach
-- (announced in 0050 comment: "The foreign keys to leave_request and
--  break_breach arrive with steps 6 and 8.")
-- ---------------------------------------------------------------------
ALTER TABLE attendance_overlay
  ADD CONSTRAINT fk_attendance_overlay_break_breach
  FOREIGN KEY (organization_id, break_breach_id)
  REFERENCES break_breach (organization_id, id);

-- ---------------------------------------------------------------------
-- Evaluation watermark columns on attendance_record
-- breaks_evaluated_version already exists (added in 0050).
-- Add breaks_evaluation_revision for compare-and-set semantics (§13).
-- ---------------------------------------------------------------------
ALTER TABLE attendance_record
  ADD COLUMN breaks_evaluation_revision bigint NOT NULL DEFAULT 0,
  ADD COLUMN break_policy_snapshot      jsonb;

-- Index for evaluation scan: closed records where break evaluation is stale
-- (breaks_evaluated_version IS NULL or behind calculated_input_version)
CREATE INDEX ix_attendance_record_break_eval
  ON attendance_record (organization_id, user_id, work_date)
  WHERE state = 'closed'
    AND (breaks_evaluated_version IS NULL
         OR breaks_evaluated_version IS DISTINCT FROM calculated_input_version);

-- ---------------------------------------------------------------------
-- payroll_input — break deductions ready for payroll export
-- ---------------------------------------------------------------------
CREATE TABLE payroll_input (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL REFERENCES organization(id),
  user_id         uuid NOT NULL,
  period_start    date NOT NULL
                    CHECK (period_start = date_trunc('month', period_start)::date),
  kind            text NOT NULL DEFAULT 'break-deduction'
                    CHECK (kind IN ('break-deduction')),
  amount          numeric(14,4) NOT NULL CHECK (amount > 0),
  label           text NOT NULL CHECK (char_length(btrim(label)) > 0),
  break_breach_id uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid NOT NULL,
  revoked_at      timestamptz,
  revoked_by      uuid,
  revocation_reason text,
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, user_id, id),
  CHECK ((kind = 'break-deduction') = (break_breach_id IS NOT NULL)),
  -- No double-charging the same breach (including revoked history)
  UNIQUE NULLS NOT DISTINCT (organization_id, break_breach_id)
);
ALTER TABLE payroll_input
  ADD CONSTRAINT fk_payroll_input_user
  FOREIGN KEY (organization_id, user_id) REFERENCES app_user (organization_id, id);
ALTER TABLE payroll_input
  ADD CONSTRAINT fk_payroll_input_break_breach
  FOREIGN KEY (organization_id, break_breach_id)
  REFERENCES break_breach (organization_id, id);
ALTER TABLE payroll_input
  ADD CONSTRAINT fk_payroll_input_created_by
  FOREIGN KEY (organization_id, created_by) REFERENCES app_user (organization_id, id);
ALTER TABLE payroll_input
  ADD CONSTRAINT fk_payroll_input_revoked_by
  FOREIGN KEY (organization_id, revoked_by) REFERENCES app_user (organization_id, id);

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
SELECT apply_tenant_rls('break_policy');
SELECT apply_tenant_rls('break_policy_version');
SELECT apply_tenant_rls('break_penalty_rule');
SELECT apply_tenant_rls('break_policy_assignment');
SELECT apply_tenant_rls('break_breach');
SELECT apply_tenant_rls('payroll_input');

-- ---------------------------------------------------------------------
-- Privilege grants
-- Migration 0001 grants SELECT, INSERT, UPDATE and DELETE on every new
-- table by default; narrow grants are expressed as REVOKEs.
-- ---------------------------------------------------------------------

-- break_policy: update allowed (name rename), never deleted
GRANT SELECT, INSERT, UPDATE ON break_policy TO tapcrm_app;
REVOKE DELETE ON break_policy FROM tapcrm_app;

-- Versions and rules: append-only
GRANT SELECT, INSERT ON break_policy_version TO tapcrm_app;
REVOKE DELETE, UPDATE ON break_policy_version FROM tapcrm_app;

GRANT SELECT, INSERT ON break_penalty_rule TO tapcrm_app;
REVOKE DELETE, UPDATE ON break_penalty_rule FROM tapcrm_app;

-- Assignments: insert/update (priority/date adjustments), never deleted
GRANT SELECT, INSERT, UPDATE ON break_policy_assignment TO tapcrm_app;
REVOKE DELETE ON break_policy_assignment FROM tapcrm_app;

-- Breaches: insert/update (status transitions), never deleted
GRANT SELECT, INSERT, UPDATE ON break_breach TO tapcrm_app;
REVOKE DELETE ON break_breach FROM tapcrm_app;

-- Payroll input: insert/update (revocation), never deleted
GRANT SELECT, INSERT, UPDATE ON payroll_input TO tapcrm_app;
REVOKE DELETE ON payroll_input FROM tapcrm_app;
