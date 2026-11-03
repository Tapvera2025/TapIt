-- 0110 — payment gateway connector/catalog hardening.
-- Keep this forward-only migration for installations that already applied 0109.
ALTER TABLE finance_payment_gateway_config
  DROP CONSTRAINT IF EXISTS finance_payment_gateway_config_provider_check;
ALTER TABLE finance_payment_gateway_config
  ADD CONSTRAINT finance_payment_gateway_config_provider_check
  CHECK (length(btrim(provider)) BETWEEN 2 AND 64);

ALTER TABLE payment_receipt DROP CONSTRAINT IF EXISTS payment_receipt_provider_check;
ALTER TABLE payment_receipt ADD CONSTRAINT payment_receipt_provider_check
  CHECK (length(btrim(provider)) BETWEEN 2 AND 64);
