-- 0112 — Phase 4 prerequisites: payment accounts and pending policy defaults.
-- Provider activation, credentials, payment lifecycle and reconciliation remain
-- owned by the Phase 4 implementation.

INSERT INTO ledger_account (organization_id, code, name, account_type, normal_balance, system_key, is_system_account)
SELECT o.id, v.code, v.name, v.account_type, v.normal_balance, v.system_key, true
FROM organization o
CROSS JOIN (VALUES
  ('1210', 'Payment Gateway Clearing', 'asset', 'debit', 'gateway-clearing'),
  ('4200', 'Realised FX Gain', 'income', 'credit', 'fx-gain'),
  ('5110', 'Realised FX Loss', 'expense', 'debit', 'fx-loss'),
  ('2900', 'Payment Suspense', 'liability', 'credit', 'payment-suspense')
) AS v(code, name, account_type, normal_balance, system_key)
ON CONFLICT (organization_id, system_key) DO NOTHING;

CREATE TABLE finance_payment_controls (
  organization_id uuid PRIMARY KEY REFERENCES organization(id),
  bank_csv_format text NOT NULL DEFAULT 'generic_csv' CHECK (bank_csv_format IN ('generic_csv','bank_specific_pending')),
  fx_rate_source text NOT NULL DEFAULT 'manual' CHECK (fx_rate_source IN ('manual','provider_pending','rbi_pending')),
  configuration_status text NOT NULL DEFAULT 'pending_review' CHECK (configuration_status IN ('pending_review','configured')),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_finance_payment_controls_updated
  BEFORE UPDATE ON finance_payment_controls FOR EACH ROW EXECUTE FUNCTION set_updated_at();
SELECT apply_tenant_rls('finance_payment_controls');
GRANT SELECT, INSERT, UPDATE ON finance_payment_controls TO tapcrm_app;
REVOKE DELETE ON finance_payment_controls FROM tapcrm_app;

INSERT INTO finance_payment_controls (organization_id)
SELECT id FROM organization
ON CONFLICT (organization_id) DO NOTHING;
