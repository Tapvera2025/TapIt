-- Finance Phase 9: legal entities, multi-currency journal metadata, dimensions,
-- controlled schedules, FX revaluation, and external accounting sync queue.

ALTER TABLE finance_legal_entity
  ADD COLUMN IF NOT EXISTS code text,
  ADD COLUMN IF NOT EXISTS tax_registration jsonb NOT NULL DEFAULT '{}'::jsonb;
UPDATE finance_legal_entity
SET code = COALESCE(code, 'LE-' || upper(substr(replace(id::text, '-', ''), 1, 8)))
WHERE code IS NULL;
ALTER TABLE finance_legal_entity ALTER COLUMN code SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_finance_legal_entity_code ON finance_legal_entity(organization_id, code);

ALTER TABLE accounting_period
  ADD COLUMN IF NOT EXISTS legal_entity_id uuid;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'accounting_period_entity_fk') THEN
    ALTER TABLE accounting_period ADD CONSTRAINT accounting_period_entity_fk
      FOREIGN KEY (organization_id, legal_entity_id) REFERENCES finance_legal_entity(organization_id, id);
  END IF;
END $$;

ALTER TABLE journal_entry
  ADD COLUMN IF NOT EXISTS legal_entity_id uuid,
  ADD COLUMN IF NOT EXISTS transaction_currency text NOT NULL DEFAULT 'INR' CHECK (transaction_currency ~ '^[A-Z]{3}$'),
  ADD COLUMN IF NOT EXISTS base_currency text NOT NULL DEFAULT 'INR' CHECK (base_currency ~ '^[A-Z]{3}$'),
  ADD COLUMN IF NOT EXISTS exchange_rate numeric(20,8) NOT NULL DEFAULT 1 CHECK (exchange_rate > 0),
  ADD COLUMN IF NOT EXISTS exchange_rate_source text;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'journal_entry_entity_fk') THEN
    ALTER TABLE journal_entry ADD CONSTRAINT journal_entry_entity_fk
      FOREIGN KEY (organization_id, legal_entity_id) REFERENCES finance_legal_entity(organization_id, id);
  END IF;
END $$;

ALTER TABLE journal_line
  ADD COLUMN IF NOT EXISTS dimensions jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS base_debit numeric(20,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS base_credit numeric(20,2) NOT NULL DEFAULT 0;
ALTER TABLE journal_line DISABLE TRIGGER trg_journal_line_immutable;
UPDATE journal_line SET base_debit = debit, base_credit = credit
WHERE base_debit = 0 AND base_credit = 0 AND (debit <> 0 OR credit <> 0);
ALTER TABLE journal_line ENABLE TRIGGER trg_journal_line_immutable;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'journal_line_base_amounts_check') THEN
    ALTER TABLE journal_line ADD CONSTRAINT journal_line_base_amounts_check CHECK (base_debit >= 0 AND base_credit >= 0);
  END IF;
END $$;

CREATE TABLE finance_accounting_schedule (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL REFERENCES organization(id),
  legal_entity_id uuid,
  schedule_type text NOT NULL CHECK (schedule_type IN ('deferred_revenue','accrual','prepayment')),
  description text NOT NULL CHECK (length(btrim(description)) BETWEEN 2 AND 500),
  source_type text NOT NULL,
  source_id uuid,
  debit_account_id uuid NOT NULL,
  credit_account_id uuid NOT NULL,
  total_amount numeric(20,2) NOT NULL CHECK (total_amount > 0),
  recognized_amount numeric(20,2) NOT NULL DEFAULT 0 CHECK (recognized_amount >= 0 AND recognized_amount <= total_amount),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  start_date date NOT NULL,
  end_date date NOT NULL,
  next_recognition_date date NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','cancelled')),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, legal_entity_id) REFERENCES finance_legal_entity(organization_id, id),
  FOREIGN KEY (organization_id, debit_account_id) REFERENCES ledger_account(organization_id, id),
  FOREIGN KEY (organization_id, credit_account_id) REFERENCES ledger_account(organization_id, id),
  FOREIGN KEY (organization_id, created_by) REFERENCES app_user(organization_id, id),
  CHECK (end_date >= start_date), CHECK (next_recognition_date >= start_date)
);

CREATE TABLE finance_fx_revaluation_run (
  id uuid PRIMARY KEY DEFAULT uuidv7(), organization_id uuid NOT NULL REFERENCES organization(id),
  legal_entity_id uuid, as_of_date date NOT NULL, base_currency text NOT NULL CHECK (base_currency ~ '^[A-Z]{3}$'),
  status text NOT NULL DEFAULT 'posted' CHECK (status IN ('posted','reversed')),
  rates jsonb NOT NULL, journal_id uuid, created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, legal_entity_id) REFERENCES finance_legal_entity(organization_id, id),
  FOREIGN KEY (organization_id, journal_id) REFERENCES journal_entry(organization_id, id),
  FOREIGN KEY (organization_id, created_by) REFERENCES app_user(organization_id, id)
);

CREATE TABLE finance_accounting_sync_queue (
  id uuid PRIMARY KEY DEFAULT uuidv7(), organization_id uuid NOT NULL REFERENCES organization(id),
  provider text NOT NULL, entity_id uuid, source_type text NOT NULL, source_id uuid NOT NULL,
  idempotency_key text NOT NULL, payload jsonb NOT NULL, status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','processing','synced','failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0), last_error text,
  created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE (organization_id, id),
  UNIQUE (organization_id, provider, idempotency_key),
  FOREIGN KEY (organization_id, created_by) REFERENCES app_user(organization_id, id)
);

CREATE INDEX ix_accounting_schedule_due ON finance_accounting_schedule(organization_id, next_recognition_date, status);
CREATE INDEX ix_accounting_sync_status ON finance_accounting_sync_queue(organization_id, status, created_at);
CREATE INDEX ix_journal_line_dimensions ON journal_line USING gin (dimensions);

SELECT apply_tenant_rls('finance_accounting_schedule');
SELECT apply_tenant_rls('finance_fx_revaluation_run');
SELECT apply_tenant_rls('finance_accounting_sync_queue');
GRANT SELECT, INSERT, UPDATE ON finance_legal_entity, finance_accounting_schedule, finance_fx_revaluation_run, finance_accounting_sync_queue TO tapcrm_app;
REVOKE DELETE ON finance_accounting_schedule, finance_fx_revaluation_run, finance_accounting_sync_queue FROM tapcrm_app;
