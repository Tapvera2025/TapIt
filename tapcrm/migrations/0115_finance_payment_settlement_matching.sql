-- 0115 — Settlement matching and realized FX support.
ALTER TABLE finance_payment_settlement
  ADD CONSTRAINT finance_payment_settlement_org_id_key UNIQUE (organization_id, id);

ALTER TABLE finance_payment_settlement
  ADD COLUMN IF NOT EXISTS exchange_rate_bps integer
    CHECK (exchange_rate_bps IS NULL OR exchange_rate_bps > 0),
  ADD COLUMN IF NOT EXISTS journal_id uuid;

CREATE TABLE finance_payment_settlement_receipt (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL REFERENCES organization(id),
  settlement_id uuid NOT NULL,
  receipt_id uuid NOT NULL,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, settlement_id, receipt_id),
  FOREIGN KEY (organization_id, settlement_id) REFERENCES finance_payment_settlement(organization_id, id),
  FOREIGN KEY (organization_id, receipt_id) REFERENCES payment_receipt(organization_id, id)
);
CREATE INDEX ix_payment_settlement_receipt_receipt
  ON finance_payment_settlement_receipt(organization_id, receipt_id);
SELECT apply_tenant_rls('finance_payment_settlement_receipt');
GRANT SELECT, INSERT ON finance_payment_settlement_receipt TO tapcrm_app;
REVOKE DELETE ON finance_payment_settlement_receipt FROM tapcrm_app;
