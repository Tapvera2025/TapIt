-- 0129 — Make the receipt idempotency contract match the service upsert.
CREATE UNIQUE INDEX IF NOT EXISTS ux_payment_receipt_idempotency
  ON payment_receipt(organization_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
