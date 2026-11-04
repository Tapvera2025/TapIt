-- 0116 — Payment hardening: cash classification, settlement imports and FX revaluation.
ALTER TABLE payment_receipt
  ADD COLUMN IF NOT EXISTS cash_classification text NOT NULL DEFAULT 'receivable';
DO $$ BEGIN
  ALTER TABLE payment_receipt ADD CONSTRAINT payment_receipt_cash_classification_check
    CHECK (cash_classification IN ('receivable','unapplied','advance'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE finance_payment_settlement_import (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL REFERENCES organization(id),
  original_filename text NOT NULL,
  stored_filename text NOT NULL,
  relative_path text NOT NULL,
  sha256 text NOT NULL,
  provider text NOT NULL,
  row_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'imported' CHECK (status IN ('imported','partially_reconciled','reconciled','failed')),
  uploaded_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,id), UNIQUE (organization_id,sha256),
  FOREIGN KEY (organization_id,uploaded_by) REFERENCES app_user(organization_id,id)
);
SELECT apply_tenant_rls('finance_payment_settlement_import');
GRANT SELECT, INSERT, UPDATE ON finance_payment_settlement_import TO tapcrm_app;
REVOKE DELETE ON finance_payment_settlement_import FROM tapcrm_app;

CREATE TABLE finance_payment_fx_revaluation (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL REFERENCES organization(id),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$' AND currency <> 'INR'),
  as_of_date date NOT NULL,
  rate_bps integer NOT NULL CHECK (rate_bps > 0),
  carrying_minor bigint NOT NULL,
  revalued_minor bigint NOT NULL,
  difference_minor bigint NOT NULL,
  journal_id uuid,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,currency,as_of_date),
  FOREIGN KEY (organization_id,created_by) REFERENCES app_user(organization_id,id)
);
SELECT apply_tenant_rls('finance_payment_fx_revaluation');
GRANT SELECT, INSERT ON finance_payment_fx_revaluation TO tapcrm_app;
REVOKE DELETE ON finance_payment_fx_revaluation FROM tapcrm_app;
