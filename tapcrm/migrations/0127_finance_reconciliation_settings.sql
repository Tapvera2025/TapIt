-- Finance reconciliation settings are organization-scoped. Credentials are intentionally
-- not stored here; provider-specific secrets belong in the existing gateway/connector stores.
CREATE TABLE finance_reconciliation_settings (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL UNIQUE REFERENCES organization(id),
  bank_mode text NOT NULL DEFAULT 'manual_csv' CHECK (bank_mode IN ('manual_csv', 'api')),
  bank_provider text,
  bank_account_name text,
  bank_currency text NOT NULL DEFAULT 'INR' CHECK (bank_currency ~ '^[A-Z]{3}$'),
  bank_ledger_account_id uuid,
  csv_date_column text NOT NULL DEFAULT 'date',
  csv_reference_column text NOT NULL DEFAULT 'reference',
  csv_description_column text NOT NULL DEFAULT 'description',
  csv_debit_column text NOT NULL DEFAULT 'debit',
  csv_credit_column text NOT NULL DEFAULT 'credit',
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, bank_ledger_account_id) REFERENCES ledger_account(organization_id, id),
  FOREIGN KEY (organization_id, updated_by) REFERENCES app_user(organization_id, id)
);

CREATE TRIGGER trg_finance_reconciliation_settings_updated
  BEFORE UPDATE ON finance_reconciliation_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

SELECT apply_tenant_rls('finance_reconciliation_settings');
GRANT SELECT, INSERT, UPDATE ON finance_reconciliation_settings TO tapcrm_app;
REVOKE DELETE ON finance_reconciliation_settings FROM tapcrm_app;
