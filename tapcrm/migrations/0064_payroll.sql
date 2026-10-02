-- =====================================================================
-- 0064 — Payroll (attendance design §9)
--
-- Adopts payroll_input (extends kinds, fixes unique constraint, adds
-- same-person FK), adds payroll_config / payroll_config_source,
-- salary_structure / salary_structure_line, payroll_run /
-- payroll_run_employee, the payslip family, payroll_run_drift, and
-- ledger_posting_intent.
-- =====================================================================

-- =====================================================================
-- Section A: Adopt payroll_input (ALTER TABLE — 0063 owns the table)
-- =====================================================================

-- Extend kind enum
ALTER TABLE payroll_input
  DROP CONSTRAINT IF EXISTS payroll_input_kind_check;
ALTER TABLE payroll_input
  ADD CONSTRAINT payroll_input_kind_check
  CHECK (kind IN ('break-deduction', 'adjustment', 'advance-recovery', 'arrear', 'bonus', 'tds'));

-- Add reason column (required for non-break-deduction entries)
ALTER TABLE payroll_input
  ADD COLUMN IF NOT EXISTS reason text;

ALTER TABLE payroll_input
  ADD CONSTRAINT payroll_input_reason_check
  CHECK (kind = 'break-deduction' OR (reason IS NOT NULL AND char_length(btrim(reason)) > 0));

-- Fix the unique constraint: drop the across-history unique and replace with
-- a partial unique on non-revoked break_breach_id only
ALTER TABLE payroll_input
  DROP CONSTRAINT IF EXISTS payroll_input_organization_id_break_breach_id_key;

-- New: prevent double-charging the same breach (only one non-revoked charge allowed)
CREATE UNIQUE INDEX IF NOT EXISTS uq_payroll_input_active_breach
  ON payroll_input (organization_id, break_breach_id)
  WHERE break_breach_id IS NOT NULL AND revoked_at IS NULL;

-- break_breach already has UNIQUE (organization_id, user_id, id) from 0063.
-- Add a composite unique index to support the same-person FK below.
CREATE UNIQUE INDEX IF NOT EXISTS uq_break_breach_org_user_id
  ON break_breach (organization_id, user_id, id);

-- Fix the same-person FK: add FK from payroll_input to break_breach using the (org,user,id) composite
ALTER TABLE payroll_input
  DROP CONSTRAINT IF EXISTS fk_payroll_input_break_breach;
ALTER TABLE payroll_input
  ADD CONSTRAINT fk_payroll_input_break_breach_person
  FOREIGN KEY (organization_id, user_id, break_breach_id)
  REFERENCES break_breach (organization_id, user_id, id)
  DEFERRABLE INITIALLY DEFERRED;

-- =====================================================================
-- Section B: payroll_config and payroll_config_source
-- =====================================================================

CREATE TABLE payroll_config (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id  uuid NOT NULL REFERENCES organization(id),
  effective_from   date NOT NULL
                     CHECK (effective_from = date_trunc('month', effective_from)::date),
  settings         jsonb NOT NULL,
  schema_version   text NOT NULL DEFAULT 'v1' CHECK (char_length(btrim(schema_version)) > 0),
  accepted_by      uuid NOT NULL,
  accepted_at      timestamptz NOT NULL DEFAULT now(),
  ca_hr_approval   text NOT NULL CHECK (char_length(btrim(ca_hr_approval)) > 0),
  status           text NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active', 'voided', 'superseded')),
  voided_by        uuid,
  voided_at        timestamptz,
  void_reason      text,
  superseded_by    uuid,     -- FK to payroll_config set after insert
  superseded_at    timestamptz,
  supersession_actor uuid,
  supersession_reason text,
  supersedes_config_id uuid,  -- FK to payroll_config set after insert
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  CONSTRAINT chk_payroll_config_void_fields
    CHECK ((status = 'voided') = (voided_by IS NOT NULL AND voided_at IS NOT NULL AND void_reason IS NOT NULL)),
  CONSTRAINT chk_payroll_config_superseded_fields
    CHECK (status != 'superseded' OR (superseded_by IS NOT NULL AND superseded_at IS NOT NULL AND supersession_actor IS NOT NULL AND supersession_reason IS NOT NULL))
);

-- One active (non-voided, non-superseded) config per effective_from per org
CREATE UNIQUE INDEX uq_payroll_config_active_month
  ON payroll_config (organization_id, effective_from)
  WHERE status = 'active';

ALTER TABLE payroll_config
  ADD CONSTRAINT fk_payroll_config_accepted_by
  FOREIGN KEY (organization_id, accepted_by) REFERENCES app_user(organization_id, id);
ALTER TABLE payroll_config
  ADD CONSTRAINT fk_payroll_config_superseded_by
  FOREIGN KEY (organization_id, superseded_by) REFERENCES payroll_config(organization_id, id)
  DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE payroll_config
  ADD CONSTRAINT fk_payroll_config_supersedes
  FOREIGN KEY (organization_id, supersedes_config_id) REFERENCES payroll_config(organization_id, id)
  DEFERRABLE INITIALLY DEFERRED;

-- Immutability guard: only status/void/supersession metadata may change
CREATE OR REPLACE FUNCTION payroll_config_immutability() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.settings IS DISTINCT FROM NEW.settings
    OR OLD.effective_from IS DISTINCT FROM NEW.effective_from
    OR OLD.accepted_by IS DISTINCT FROM NEW.accepted_by
    OR OLD.accepted_at IS DISTINCT FROM NEW.accepted_at
    OR OLD.ca_hr_approval IS DISTINCT FROM NEW.ca_hr_approval
    OR OLD.schema_version IS DISTINCT FROM NEW.schema_version
  THEN
    RAISE EXCEPTION 'payroll_config: accepted values and evidence are immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_payroll_config_immutability
  BEFORE UPDATE ON payroll_config
  FOR EACH ROW EXECUTE FUNCTION payroll_config_immutability();

CREATE TABLE payroll_config_source (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id  uuid NOT NULL REFERENCES organization(id),
  config_id        uuid NOT NULL,
  statutory_choice text NOT NULL CHECK (char_length(btrim(statutory_choice)) > 0),
  issuer           text NOT NULL CHECK (char_length(btrim(issuer)) > 0),
  title            text NOT NULL CHECK (char_length(btrim(title)) > 0),
  reference        text NOT NULL CHECK (char_length(btrim(reference)) > 0),
  source_date      date NOT NULL,
  effective_date   date NOT NULL,
  retained_object_key text,
  retained_sha256  text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  CONSTRAINT chk_source_retained_pair
    CHECK ((retained_object_key IS NULL) = (retained_sha256 IS NULL)),
  FOREIGN KEY (organization_id, config_id) REFERENCES payroll_config(organization_id, id)
);

-- =====================================================================
-- Section C: salary_structure and salary_structure_line
-- =====================================================================

-- Requires btree_gist extension for exclusion constraint
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE salary_structure (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id  uuid NOT NULL REFERENCES organization(id),
  user_id          uuid NOT NULL,
  currency         char(3) NOT NULL,
  effective_from   date NOT NULL,
  effective_to     date,  -- NULL = open-ended
  created_by       uuid NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  CONSTRAINT chk_salary_structure_range
    CHECK (effective_to IS NULL OR effective_to > effective_from),
  EXCLUDE USING gist (
    organization_id WITH =,
    user_id WITH =,
    daterange(effective_from, COALESCE(effective_to, 'infinity'::date), '[)') WITH &&
  )
);

ALTER TABLE salary_structure
  ADD CONSTRAINT fk_salary_structure_user
  FOREIGN KEY (organization_id, user_id) REFERENCES app_user(organization_id, id);
ALTER TABLE salary_structure
  ADD CONSTRAINT fk_salary_structure_created_by
  FOREIGN KEY (organization_id, created_by) REFERENCES app_user(organization_id, id);

-- Guard: only effective_to may change, and only to an earlier valid value; never extend
CREATE OR REPLACE FUNCTION salary_structure_immutability() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.organization_id IS DISTINCT FROM NEW.organization_id
    OR OLD.user_id IS DISTINCT FROM NEW.user_id
    OR OLD.currency IS DISTINCT FROM NEW.currency
    OR OLD.effective_from IS DISTINCT FROM NEW.effective_from
    OR OLD.created_by IS DISTINCT FROM NEW.created_by
  THEN
    RAISE EXCEPTION 'salary_structure: identity columns are immutable';
  END IF;
  -- effective_to may only decrease (never extend or become NULL once set)
  IF NEW.effective_to IS NULL AND OLD.effective_to IS NOT NULL THEN
    RAISE EXCEPTION 'salary_structure: effective_to cannot be removed once set';
  END IF;
  IF OLD.effective_to IS NOT NULL AND NEW.effective_to IS NOT NULL AND NEW.effective_to > OLD.effective_to THEN
    RAISE EXCEPTION 'salary_structure: effective_to cannot be extended';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_salary_structure_immutability
  BEFORE UPDATE ON salary_structure
  FOR EACH ROW EXECUTE FUNCTION salary_structure_immutability();

CREATE TABLE salary_structure_line (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id  uuid NOT NULL REFERENCES organization(id),
  structure_id     uuid NOT NULL,
  code             text NOT NULL CHECK (char_length(btrim(code)) > 0),
  label            text NOT NULL CHECK (char_length(btrim(label)) > 0),
  kind             text NOT NULL CHECK (kind IN ('earning', 'deduction', 'employer-contribution')),
  amount           numeric(14,4) NOT NULL CHECK (amount >= 0),
  prorated         boolean NOT NULL DEFAULT true,
  statutory_tags   text[] NOT NULL DEFAULT '{}',
  sort_order       integer NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, structure_id, code),
  UNIQUE (organization_id, structure_id, sort_order),
  FOREIGN KEY (organization_id, structure_id) REFERENCES salary_structure(organization_id, id)
);

-- =====================================================================
-- Section D: payroll_run, payroll_run_employee
-- =====================================================================

CREATE TABLE payroll_run (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id  uuid NOT NULL REFERENCES organization(id),
  period_start     date NOT NULL
                     CHECK (period_start = date_trunc('month', period_start)::date),
  period_end       date NOT NULL,
  config_id        uuid NOT NULL,
  status           text NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft','computing','review','publishing','published','failed','cancelled')),
  population_fingerprint text,
  config_fingerprint     text,
  inputs_changed   boolean NOT NULL DEFAULT false,
  created_by       uuid NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  published_at     timestamptz,
  UNIQUE (organization_id, id),
  CONSTRAINT chk_payroll_run_period
    CHECK (period_end >= period_start),
  FOREIGN KEY (organization_id, config_id) REFERENCES payroll_config(organization_id, id)
);

ALTER TABLE payroll_run
  ADD CONSTRAINT fk_payroll_run_created_by
  FOREIGN KEY (organization_id, created_by) REFERENCES app_user(organization_id, id);

-- One non-failed/non-cancelled run per org/month
CREATE UNIQUE INDEX uq_payroll_run_active_month
  ON payroll_run (organization_id, period_start)
  WHERE status NOT IN ('failed', 'cancelled');

CREATE TABLE payroll_run_employee (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id  uuid NOT NULL REFERENCES organization(id),
  run_id           uuid NOT NULL,
  user_id          uuid NOT NULL,
  employment_window_start date NOT NULL,
  employment_window_end   date,
  inputs           jsonb NOT NULL,
  inputs_fingerprint text NOT NULL,
  status           text NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','computing','computed','failed')),
  computed_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, run_id, user_id),
  FOREIGN KEY (organization_id, run_id) REFERENCES payroll_run(organization_id, id),
  FOREIGN KEY (organization_id, user_id) REFERENCES app_user(organization_id, id)
);

-- =====================================================================
-- Section E: payslip family
-- =====================================================================

CREATE TABLE payslip (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id  uuid NOT NULL REFERENCES organization(id),
  run_id           uuid NOT NULL,
  user_id          uuid NOT NULL,
  period_start     date NOT NULL,
  period_end       date NOT NULL,
  revision_number  integer NOT NULL DEFAULT 0 CHECK (revision_number >= 0),
  previous_slip_id uuid,
  status           text NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft','published','failed','cancelled')),
  gross_paise      bigint,
  deductions_paise bigint,
  net_paise        bigint,
  employer_contribution_paise bigint,
  inputs           jsonb,
  inputs_fingerprint text,
  immutable        boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  published_at     timestamptz,
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, run_id) REFERENCES payroll_run(organization_id, id),
  FOREIGN KEY (organization_id, user_id) REFERENCES app_user(organization_id, id),
  CONSTRAINT chk_payslip_totals
    CHECK (status != 'published' OR (
      gross_paise IS NOT NULL AND deductions_paise IS NOT NULL AND net_paise IS NOT NULL
      AND net_paise = gross_paise - deductions_paise
    ))
);

-- One draft per person per run
CREATE UNIQUE INDEX uq_payslip_draft
  ON payslip (organization_id, run_id, user_id)
  WHERE status = 'draft';

-- Published revision namespace: person/month/revision unique
CREATE UNIQUE INDEX uq_payslip_published_revision
  ON payslip (organization_id, user_id, period_start, revision_number)
  WHERE status = 'published';

ALTER TABLE payslip
  ADD CONSTRAINT fk_payslip_previous
  FOREIGN KEY (organization_id, previous_slip_id) REFERENCES payslip(organization_id, id)
  DEFERRABLE INITIALLY DEFERRED;

-- Published payslip immutability trigger
CREATE OR REPLACE FUNCTION payslip_immutability() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.immutable AND (
    OLD.gross_paise IS DISTINCT FROM NEW.gross_paise
    OR OLD.deductions_paise IS DISTINCT FROM NEW.deductions_paise
    OR OLD.net_paise IS DISTINCT FROM NEW.net_paise
    OR OLD.employer_contribution_paise IS DISTINCT FROM NEW.employer_contribution_paise
    OR OLD.inputs IS DISTINCT FROM NEW.inputs
    OR OLD.inputs_fingerprint IS DISTINCT FROM NEW.inputs_fingerprint
    OR OLD.revision_number IS DISTINCT FROM NEW.revision_number
    OR OLD.user_id IS DISTINCT FROM NEW.user_id
    OR OLD.run_id IS DISTINCT FROM NEW.run_id
    OR OLD.period_start IS DISTINCT FROM NEW.period_start
  ) THEN
    RAISE EXCEPTION 'payslip: published slip is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_payslip_immutability
  BEFORE UPDATE ON payslip
  FOR EACH ROW EXECUTE FUNCTION payslip_immutability();

CREATE TABLE payslip_line (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id  uuid NOT NULL REFERENCES organization(id),
  payslip_id       uuid NOT NULL,
  code             text NOT NULL,
  label            text NOT NULL,
  kind             text NOT NULL CHECK (kind IN ('earning','deduction','employer-contribution')),
  amount_paise     bigint NOT NULL,
  basis            jsonb,
  sort_order       integer NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, payslip_id) REFERENCES payslip(organization_id, id)
);

-- Guard: no line insert/delete on published payslips
CREATE OR REPLACE FUNCTION payslip_line_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  slip_immutable boolean;
BEGIN
  SELECT immutable INTO slip_immutable FROM payslip WHERE id = COALESCE(NEW.payslip_id, OLD.payslip_id) AND organization_id = COALESCE(NEW.organization_id, OLD.organization_id);
  IF slip_immutable THEN
    RAISE EXCEPTION 'payslip_line: cannot modify lines of a published payslip';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trg_payslip_line_insert_guard
  BEFORE INSERT ON payslip_line
  FOR EACH ROW EXECUTE FUNCTION payslip_line_guard();

CREATE TRIGGER trg_payslip_line_delete_guard
  BEFORE DELETE ON payslip_line
  FOR EACH ROW EXECUTE FUNCTION payslip_line_guard();

CREATE TABLE payslip_salary_use (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id  uuid NOT NULL REFERENCES organization(id),
  payslip_id       uuid NOT NULL,
  structure_id     uuid NOT NULL,
  used_from        date NOT NULL,
  used_to          date NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, payslip_id) REFERENCES payslip(organization_id, id),
  FOREIGN KEY (organization_id, structure_id) REFERENCES salary_structure(organization_id, id),
  CONSTRAINT chk_payslip_salary_use_range CHECK (used_to >= used_from)
);

CREATE TABLE payslip_document (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id  uuid NOT NULL REFERENCES organization(id),
  payslip_id       uuid NOT NULL,
  object_key       text NOT NULL CHECK (char_length(btrim(object_key)) > 0),
  sha256           text NOT NULL,
  rendered_at      timestamptz NOT NULL DEFAULT now(),
  notified_at      timestamptz,
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, payslip_id),  -- write-once per payslip
  FOREIGN KEY (organization_id, payslip_id) REFERENCES payslip(organization_id, id)
);

CREATE TABLE payslip_flag (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id  uuid NOT NULL REFERENCES organization(id),
  payslip_id       uuid NOT NULL,
  source_type      text NOT NULL CHECK (char_length(btrim(source_type)) > 0),
  source_id        text NOT NULL CHECK (char_length(btrim(source_id)) > 0),
  kind             text NOT NULL CHECK (kind IN ('inputs-changed','blocker','population-change')),
  resolved         boolean NOT NULL DEFAULT false,
  resolved_at      timestamptz,
  resolved_by      uuid,
  resolution_reason text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, payslip_id, source_type, source_id),
  FOREIGN KEY (organization_id, payslip_id) REFERENCES payslip(organization_id, id)
);

-- =====================================================================
-- Section F: payroll_run_drift
-- =====================================================================

CREATE TABLE payroll_run_drift (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id  uuid NOT NULL REFERENCES organization(id),
  run_id           uuid NOT NULL,
  user_id          uuid NOT NULL,
  kind             text NOT NULL CHECK (kind IN ('population-entry','population-reduced','blocker')),
  source_type      text,
  source_id        text,
  opened_at        timestamptz NOT NULL DEFAULT now(),
  resolved_at      timestamptz,
  resolved_by_payslip_id uuid,
  resolution_actor text,
  resolution_reason text,
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, run_id) REFERENCES payroll_run(organization_id, id),
  FOREIGN KEY (organization_id, user_id) REFERENCES app_user(organization_id, id),
  CONSTRAINT chk_drift_resolved
    CHECK (resolved_at IS NULL OR resolution_actor IS NOT NULL)
);

ALTER TABLE payroll_run_drift
  ADD CONSTRAINT fk_drift_resolving_payslip
  FOREIGN KEY (organization_id, resolved_by_payslip_id) REFERENCES payslip(organization_id, id)
  DEFERRABLE INITIALLY DEFERRED;

-- One open population drift per (org, run, user, kind)
CREATE UNIQUE INDEX uq_payroll_drift_open_population
  ON payroll_run_drift (organization_id, run_id, user_id, kind)
  WHERE resolved_at IS NULL AND kind IN ('population-entry','population-reduced');

-- One open blocker drift per (org, run, source_type, source_id)
CREATE UNIQUE INDEX uq_payroll_drift_open_blocker
  ON payroll_run_drift (organization_id, run_id, source_type, source_id)
  WHERE resolved_at IS NULL AND kind = 'blocker';

-- =====================================================================
-- Section G: ledger_posting_intent
-- =====================================================================

CREATE TABLE ledger_posting_intent (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id  uuid NOT NULL REFERENCES organization(id),
  kind             text NOT NULL CHECK (kind IN ('posting','zero-delta-revision')),
  run_id           uuid NOT NULL,
  payslip_id       uuid,
  debit_total_paise  bigint NOT NULL CHECK (debit_total_paise >= 0),
  credit_total_paise bigint NOT NULL CHECK (credit_total_paise >= 0),
  lines            jsonb NOT NULL DEFAULT '[]',
  consumed_at      timestamptz,
  journal_id       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, run_id, payslip_id),
  FOREIGN KEY (organization_id, run_id) REFERENCES payroll_run(organization_id, id),
  CONSTRAINT chk_intent_balance
    CHECK (debit_total_paise = credit_total_paise),
  CONSTRAINT chk_intent_zero_delta
    CHECK (kind != 'zero-delta-revision' OR (debit_total_paise = 0 AND credit_total_paise = 0 AND lines = '[]'::jsonb)),
  CONSTRAINT chk_intent_posting_lines
    CHECK (kind != 'posting' OR jsonb_array_length(lines) > 0)
);

ALTER TABLE ledger_posting_intent
  ADD CONSTRAINT fk_intent_payslip
  FOREIGN KEY (organization_id, payslip_id) REFERENCES payslip(organization_id, id)
  DEFERRABLE INITIALLY DEFERRED;

-- =====================================================================
-- Section H: RLS
-- =====================================================================

SELECT apply_tenant_rls('payroll_config');
SELECT apply_tenant_rls('payroll_config_source');
SELECT apply_tenant_rls('salary_structure');
SELECT apply_tenant_rls('salary_structure_line');
SELECT apply_tenant_rls('payroll_run');
SELECT apply_tenant_rls('payroll_run_employee');
SELECT apply_tenant_rls('payslip');
SELECT apply_tenant_rls('payslip_line');
SELECT apply_tenant_rls('payslip_salary_use');
SELECT apply_tenant_rls('payslip_document');
SELECT apply_tenant_rls('payslip_flag');
SELECT apply_tenant_rls('payroll_run_drift');
SELECT apply_tenant_rls('ledger_posting_intent');

-- =====================================================================
-- Section I: Privilege grants
-- =====================================================================

-- payroll_config: append-only values; status metadata update allowed
GRANT SELECT, INSERT, UPDATE ON payroll_config TO tapcrm_app;
REVOKE DELETE ON payroll_config FROM tapcrm_app;

-- payroll_config_source: append-only
GRANT SELECT, INSERT ON payroll_config_source TO tapcrm_app;
REVOKE DELETE, UPDATE ON payroll_config_source FROM tapcrm_app;

-- salary_structure: effective_to narrowing allowed
GRANT SELECT, INSERT, UPDATE ON salary_structure TO tapcrm_app;
REVOKE DELETE ON salary_structure FROM tapcrm_app;

-- salary_structure_line: append-only (triggers protect published structures)
GRANT SELECT, INSERT ON salary_structure_line TO tapcrm_app;
REVOKE DELETE, UPDATE ON salary_structure_line FROM tapcrm_app;

-- payroll_run: status transitions allowed
GRANT SELECT, INSERT, UPDATE ON payroll_run TO tapcrm_app;
REVOKE DELETE ON payroll_run FROM tapcrm_app;

-- payroll_run_employee: inputs frozen at freeze; status/computed_at update
GRANT SELECT, INSERT, UPDATE ON payroll_run_employee TO tapcrm_app;
REVOKE DELETE ON payroll_run_employee FROM tapcrm_app;

-- payslip: draft creation, publication (status→published, immutable→true)
GRANT SELECT, INSERT, UPDATE ON payslip TO tapcrm_app;
REVOKE DELETE ON payslip FROM tapcrm_app;

-- payslip_line: insert/delete allowed for draft regeneration (trigger blocks published)
GRANT SELECT, INSERT, DELETE ON payslip_line TO tapcrm_app;
REVOKE UPDATE ON payslip_line FROM tapcrm_app;

-- payslip_salary_use: insert/delete allowed for draft regeneration
GRANT SELECT, INSERT, DELETE ON payslip_salary_use TO tapcrm_app;
REVOKE UPDATE ON payslip_salary_use FROM tapcrm_app;

-- payslip_document: write-once (unique index enforces); no delete
GRANT SELECT, INSERT ON payslip_document TO tapcrm_app;
REVOKE DELETE, UPDATE ON payslip_document FROM tapcrm_app;

-- payslip_flag: insert; resolution update
GRANT SELECT, INSERT, UPDATE ON payslip_flag TO tapcrm_app;
REVOKE DELETE ON payslip_flag FROM tapcrm_app;

-- payroll_run_drift: insert; resolution update
GRANT SELECT, INSERT, UPDATE ON payroll_run_drift TO tapcrm_app;
REVOKE DELETE ON payroll_run_drift FROM tapcrm_app;

-- ledger_posting_intent: insert; consumed_at/journal_id update only
GRANT SELECT, INSERT, UPDATE ON ledger_posting_intent TO tapcrm_app;
REVOKE DELETE ON ledger_posting_intent FROM tapcrm_app;
