-- 0109 — tenant payment gateway configuration.
-- Secrets are encrypted by the application before they reach this table.
CREATE TABLE finance_payment_gateway_config (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL REFERENCES organization(id),
  legal_entity_id uuid,
  provider text NOT NULL CHECK (provider IN ('razorpay','stripe','cashfree','paypal')),
  environment text NOT NULL DEFAULT 'production' CHECK (environment IN ('production','sandbox')),
  public_key text,
  encrypted_secret_key text NOT NULL,
  encrypted_webhook_key text NOT NULL,
  hyperswitch_connector_id text,
  supported_currencies text[] NOT NULL DEFAULT ARRAY['INR']::text[],
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, provider, environment),
  FOREIGN KEY (organization_id, legal_entity_id)
    REFERENCES finance_legal_entity (organization_id, id),
  FOREIGN KEY (organization_id, created_by)
    REFERENCES app_user (organization_id, id)
);

CREATE INDEX ix_finance_pg_config_org
  ON finance_payment_gateway_config (organization_id, is_active);
SELECT apply_tenant_rls('finance_payment_gateway_config');
CREATE TRIGGER trg_finance_pg_config_updated
  BEFORE UPDATE ON finance_payment_gateway_config
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
GRANT SELECT, INSERT, UPDATE, DELETE ON finance_payment_gateway_config TO tapcrm_app;

-- 0086 predated the unified gateway layer and allowed only Razorpay/manual
-- receipt providers. Keep the existing manual values while admitting every
-- provider selectable in Finance Settings.
ALTER TABLE payment_receipt DROP CONSTRAINT IF EXISTS payment_receipt_provider_check;
ALTER TABLE payment_receipt ADD CONSTRAINT payment_receipt_provider_check
  CHECK (provider IN ('razorpay','stripe','cashfree','paypal','bank_transfer','cash','cheque','manual'));

-- Used only when a provider reports a non-zero processing fee.
INSERT INTO ledger_account
  (organization_id, code, name, account_type, normal_balance, system_key, is_system_account)
SELECT o.id, '5300', 'Payment Gateway Fee Expense', 'expense', 'debit', 'gateway-fee-expense', true
FROM organization o
ON CONFLICT (organization_id, system_key) DO NOTHING;

INSERT INTO registry_action (
  action, module, resource, domain, sensitive, approval_bearing, initiator_field,
  position_grantable, delegation_allowed, super_admin_only, description
) VALUES (
  'finance:manage-payment-gateways', 'accounting', NULL, 'business', true, false, NULL,
  true, false, false, 'Configure and manage company payment gateways.'
)
ON CONFLICT (action) DO UPDATE SET description = EXCLUDED.description;
