-- 0113 — Finance Phase 4: provider-neutral payments, reconciliation, FX and exceptions.

ALTER TABLE payment_receipt
  ADD COLUMN IF NOT EXISTS provider_payment_id text,
  ADD COLUMN IF NOT EXISTS settlement_id text,
  ADD COLUMN IF NOT EXISTS fee_minor bigint NOT NULL DEFAULT 0 CHECK (fee_minor >= 0),
  ADD COLUMN IF NOT EXISTS exchange_rate_bps integer CHECK (exchange_rate_bps IS NULL OR exchange_rate_bps > 0),
  ADD COLUMN IF NOT EXISTS failure_code text,
  ADD COLUMN IF NOT EXISTS verified_journal_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS ux_payment_receipt_provider_payment
  ON payment_receipt(organization_id, provider, provider_payment_id)
  WHERE provider_payment_id IS NOT NULL;

ALTER TABLE payment_allocation ALTER COLUMN deal_id DROP NOT NULL;
ALTER TABLE payment_allocation ADD COLUMN IF NOT EXISTS invoice_id uuid;
DO $$ BEGIN
  ALTER TABLE payment_allocation ADD CONSTRAINT payment_allocation_invoice_fk
    FOREIGN KEY (organization_id, invoice_id) REFERENCES finance_invoice(organization_id, id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE payment_allocation ADD CONSTRAINT payment_allocation_target_check
    CHECK (deal_id IS NOT NULL OR invoice_id IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE UNIQUE INDEX IF NOT EXISTS ux_payment_allocation_receipt_invoice
  ON payment_allocation(organization_id, receipt_id, invoice_id)
  WHERE invoice_id IS NOT NULL;

CREATE TABLE finance_payment (
  id uuid PRIMARY KEY DEFAULT uuidv7(), organization_id uuid NOT NULL REFERENCES organization(id),
  provider text NOT NULL, provider_payment_id text, reference_type text NOT NULL CHECK (reference_type IN ('invoice','deal','manual')),
  reference_id uuid, amount_minor bigint NOT NULL CHECK (amount_minor > 0), currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  status text NOT NULL DEFAULT 'created' CHECK (status IN ('created','pending','authorized','captured','failed','cancelled','refunded','partially_refunded')),
  idempotency_key text NOT NULL, checkout_url text, failure_code text, created_by uuid, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,id), UNIQUE (organization_id,idempotency_key), UNIQUE (organization_id,provider,provider_payment_id),
  FOREIGN KEY (organization_id,created_by) REFERENCES app_user(organization_id,id)
);
CREATE INDEX ix_finance_payment_status ON finance_payment(organization_id,status,created_at DESC);

CREATE TABLE finance_bank_statement_import (
  id uuid PRIMARY KEY DEFAULT uuidv7(), organization_id uuid NOT NULL REFERENCES organization(id), original_filename text NOT NULL,
  stored_filename text NOT NULL, relative_path text NOT NULL, sha256 text NOT NULL, format text NOT NULL DEFAULT 'generic_csv',
  status text NOT NULL DEFAULT 'imported' CHECK (status IN ('imported','partially_matched','reconciled','failed')),
  row_count integer NOT NULL DEFAULT 0, uploaded_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,id), UNIQUE (organization_id,sha256), FOREIGN KEY (organization_id,uploaded_by) REFERENCES app_user(organization_id,id)
);
CREATE TABLE finance_bank_statement_line (
  id uuid PRIMARY KEY DEFAULT uuidv7(), organization_id uuid NOT NULL REFERENCES organization(id), import_id uuid NOT NULL,
  line_fingerprint text NOT NULL, transaction_date date NOT NULL, value_date date, reference text, description text,
  debit_minor bigint NOT NULL DEFAULT 0 CHECK (debit_minor >= 0), credit_minor bigint NOT NULL DEFAULT 0 CHECK (credit_minor >= 0),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'), balance_minor bigint, matched_receipt_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (organization_id,id), UNIQUE (organization_id,line_fingerprint),
  FOREIGN KEY (organization_id,import_id) REFERENCES finance_bank_statement_import(organization_id,id),
  FOREIGN KEY (organization_id,matched_receipt_id) REFERENCES payment_receipt(organization_id,id),
  CHECK ((debit_minor = 0 AND credit_minor > 0) OR (credit_minor = 0 AND debit_minor > 0))
);
CREATE INDEX ix_finance_bank_line_unmatched ON finance_bank_statement_line(organization_id,matched_receipt_id,transaction_date);

CREATE TABLE finance_payment_settlement (
  id uuid PRIMARY KEY DEFAULT uuidv7(), organization_id uuid NOT NULL REFERENCES organization(id), provider text NOT NULL,
  settlement_reference text NOT NULL, settlement_date date NOT NULL, currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  gross_minor bigint NOT NULL CHECK (gross_minor >= 0), fee_minor bigint NOT NULL DEFAULT 0 CHECK (fee_minor >= 0), net_minor bigint NOT NULL CHECK (net_minor >= 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','matched','mismatched','reconciled')), mismatch_reason text,
  created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (organization_id,provider,settlement_reference),
  FOREIGN KEY (organization_id,created_by) REFERENCES app_user(organization_id,id), CHECK (net_minor = gross_minor - fee_minor)
);

CREATE TABLE finance_payment_fx_rate (
  id uuid PRIMARY KEY DEFAULT uuidv7(), organization_id uuid NOT NULL REFERENCES organization(id), base_currency text NOT NULL CHECK (base_currency ~ '^[A-Z]{3}$'),
  quote_currency text NOT NULL CHECK (quote_currency ~ '^[A-Z]{3}$'), rate_bps integer NOT NULL CHECK (rate_bps > 0), effective_at timestamptz NOT NULL,
  source text NOT NULL CHECK (source IN ('manual','provider','rbi')), created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,base_currency,quote_currency,effective_at), FOREIGN KEY (organization_id,created_by) REFERENCES app_user(organization_id,id), CHECK (base_currency <> quote_currency)
);

CREATE TABLE finance_payment_exception (
  id uuid PRIMARY KEY DEFAULT uuidv7(), organization_id uuid NOT NULL REFERENCES organization(id), exception_type text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_review','resolved','ignored')), reason text NOT NULL, payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  receipt_id uuid, statement_line_id uuid, assigned_to uuid, resolution text, resolved_by uuid, resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,id), FOREIGN KEY (organization_id,receipt_id) REFERENCES payment_receipt(organization_id,id),
  FOREIGN KEY (organization_id,statement_line_id) REFERENCES finance_bank_statement_line(organization_id,id),
  FOREIGN KEY (organization_id,assigned_to) REFERENCES app_user(organization_id,id), FOREIGN KEY (organization_id,resolved_by) REFERENCES app_user(organization_id,id)
);

CREATE INDEX ix_finance_payment_exception_queue ON finance_payment_exception(organization_id,status,created_at);
SELECT apply_tenant_rls('finance_payment'); SELECT apply_tenant_rls('finance_bank_statement_import');
SELECT apply_tenant_rls('finance_bank_statement_line'); SELECT apply_tenant_rls('finance_payment_settlement');
SELECT apply_tenant_rls('finance_payment_fx_rate'); SELECT apply_tenant_rls('finance_payment_exception');
CREATE TRIGGER trg_finance_payment_updated BEFORE UPDATE ON finance_payment FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_finance_payment_exception_updated BEFORE UPDATE ON finance_payment_exception FOR EACH ROW EXECUTE FUNCTION set_updated_at();
GRANT SELECT, INSERT, UPDATE ON finance_payment, finance_bank_statement_import, finance_bank_statement_line, finance_payment_settlement, finance_payment_fx_rate, finance_payment_exception TO tapcrm_app;
REVOKE DELETE ON finance_payment, finance_bank_statement_import, finance_bank_statement_line, finance_payment_settlement, finance_payment_fx_rate, finance_payment_exception FROM tapcrm_app;
