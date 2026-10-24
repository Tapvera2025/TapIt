-- =====================================================================
-- 0095 — Finance / Accounting ledger core (P6 Phase 2)
--
-- Journal rows are append-only. The database, rather than only the HTTP
-- service, owns the invariants that make a posted ledger authoritative.
-- =====================================================================

CREATE TABLE journal_entry (
  id                  uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id     uuid NOT NULL REFERENCES organization(id),
  period_id           uuid NOT NULL,
  entry_date          date NOT NULL,
  description         text NOT NULL CHECK (length(trim(description)) > 0),
  source_type         text NOT NULL CHECK (length(trim(source_type)) > 0),
  source_id           uuid,
  reason              text,
  posted_by           uuid NOT NULL,
  posted_at           timestamptz NOT NULL DEFAULT now(),
  reversal_of_id      uuid,
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, period_id)
    REFERENCES accounting_period (organization_id, id),
  FOREIGN KEY (organization_id, posted_by)
    REFERENCES app_user (organization_id, id),
  FOREIGN KEY (organization_id, reversal_of_id)
    REFERENCES journal_entry (organization_id, id),
  CHECK (reason IS NULL OR length(trim(reason)) > 0)
);

CREATE UNIQUE INDEX ux_journal_entry_one_reversal
  ON journal_entry (organization_id, reversal_of_id)
  WHERE reversal_of_id IS NOT NULL;

CREATE INDEX ix_journal_entry_period_date
  ON journal_entry (organization_id, period_id, entry_date, posted_at);

CREATE TABLE journal_line (
  id                  uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id     uuid NOT NULL REFERENCES organization(id),
  journal_entry_id    uuid NOT NULL,
  ledger_account_id   uuid NOT NULL,
  debit               numeric(20, 2) NOT NULL DEFAULT 0,
  credit              numeric(20, 2) NOT NULL DEFAULT 0,
  description         text,
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, journal_entry_id)
    REFERENCES journal_entry (organization_id, id),
  FOREIGN KEY (organization_id, ledger_account_id)
    REFERENCES ledger_account (organization_id, id),
  CHECK (debit >= 0 AND credit >= 0),
  CHECK ((debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0)),
  CHECK (description IS NULL OR length(trim(description)) > 0)
);

CREATE INDEX ix_journal_line_account
  ON journal_line (organization_id, ledger_account_id, journal_entry_id);

CREATE TABLE account_balance (
  organization_id     uuid NOT NULL REFERENCES organization(id),
  period_id           uuid NOT NULL,
  ledger_account_id   uuid NOT NULL,
  debit_total         numeric(20, 2) NOT NULL DEFAULT 0,
  credit_total        numeric(20, 2) NOT NULL DEFAULT 0,
  balance             numeric(20, 2) NOT NULL DEFAULT 0,
  PRIMARY KEY (organization_id, period_id, ledger_account_id),
  FOREIGN KEY (organization_id, period_id)
    REFERENCES accounting_period (organization_id, id),
  FOREIGN KEY (organization_id, ledger_account_id)
    REFERENCES ledger_account (organization_id, id),
  CHECK (debit_total >= 0 AND credit_total >= 0),
  CHECK (balance = debit_total - credit_total)
);

CREATE INDEX ix_account_balance_period
  ON account_balance (organization_id, period_id, ledger_account_id);

CREATE OR REPLACE FUNCTION accounting_lock_posting_period()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  period_row accounting_period%ROWTYPE;
BEGIN
  SELECT * INTO period_row
  FROM accounting_period
  WHERE organization_id = NEW.organization_id AND id = NEW.period_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ACCOUNTING_PERIOD_NOT_FOUND';
  END IF;

  IF NEW.entry_date < period_row.period_start OR NEW.entry_date > period_row.period_end THEN
    RAISE EXCEPTION 'ACCOUNTING_ENTRY_DATE_OUTSIDE_PERIOD';
  END IF;

  IF period_row.status NOT IN ('open', 'reopened') THEN
    RAISE EXCEPTION 'ACCOUNTING_PERIOD_CLOSED';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_journal_entry_period_lock
  BEFORE INSERT ON journal_entry
  FOR EACH ROW EXECUTE FUNCTION accounting_lock_posting_period();

CREATE OR REPLACE FUNCTION accounting_assert_journal_balanced()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  journal_id uuid;
  debit_total numeric(20, 2);
  credit_total numeric(20, 2);
  line_count integer;
BEGIN
  journal_id := CASE WHEN TG_TABLE_NAME = 'journal_entry' THEN NEW.id ELSE NEW.journal_entry_id END;

  SELECT count(*)::integer, COALESCE(sum(debit), 0), COALESCE(sum(credit), 0)
  INTO line_count, debit_total, credit_total
  FROM journal_line
  WHERE organization_id = NEW.organization_id AND journal_entry_id = journal_id;

  IF line_count = 0 OR debit_total <> credit_total THEN
    RAISE EXCEPTION 'ACCOUNTING_JOURNAL_UNBALANCED';
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER trg_journal_entry_balanced
  AFTER INSERT ON journal_entry
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION accounting_assert_journal_balanced();

CREATE CONSTRAINT TRIGGER trg_journal_line_balanced
  AFTER INSERT ON journal_line
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION accounting_assert_journal_balanced();

CREATE OR REPLACE FUNCTION accounting_reject_journal_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'ACCOUNTING_JOURNAL_IMMUTABLE';
END;
$$;

CREATE TRIGGER trg_journal_entry_immutable
  BEFORE UPDATE OR DELETE ON journal_entry
  FOR EACH ROW EXECUTE FUNCTION accounting_reject_journal_mutation();

CREATE TRIGGER trg_journal_line_immutable
  BEFORE UPDATE OR DELETE ON journal_line
  FOR EACH ROW EXECUTE FUNCTION accounting_reject_journal_mutation();

SELECT apply_tenant_rls('journal_entry');
SELECT apply_tenant_rls('journal_line');
SELECT apply_tenant_rls('account_balance');

GRANT SELECT, INSERT ON journal_entry TO tapcrm_app;
REVOKE UPDATE, DELETE ON journal_entry FROM tapcrm_app;
GRANT SELECT, INSERT ON journal_line TO tapcrm_app;
REVOKE UPDATE, DELETE ON journal_line FROM tapcrm_app;
GRANT SELECT, INSERT, UPDATE ON account_balance TO tapcrm_app;
REVOKE DELETE ON account_balance FROM tapcrm_app;
