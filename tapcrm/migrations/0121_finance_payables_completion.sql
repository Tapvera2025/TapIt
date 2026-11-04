-- Finance Phase 6 completion: recurring source periods, purchase matching,
-- reimbursement compatibility, and vendor-bank review visibility.

ALTER TABLE finance_payable_bill
  ALTER COLUMN vendor_id DROP NOT NULL;

ALTER TABLE finance_payable_bill
  ADD COLUMN IF NOT EXISTS source_period date;

ALTER TABLE finance_payable_bill
  DROP CONSTRAINT IF EXISTS finance_payable_bill_organization_id_source_type_source_id_key;

ALTER TABLE finance_payable_bill
  ADD CONSTRAINT finance_payable_bill_source_period_key
  UNIQUE (organization_id, source_type, source_id, source_period);

ALTER TABLE finance_purchase_request
  ADD COLUMN IF NOT EXISTS matched_bill_id uuid;

ALTER TABLE finance_purchase_request
  ADD CONSTRAINT finance_purchase_request_matched_bill_fk
  FOREIGN KEY (organization_id, matched_bill_id)
  REFERENCES finance_payable_bill(organization_id, id);

CREATE INDEX IF NOT EXISTS ix_finance_bank_change_status
  ON finance_vendor_bank_account(organization_id, vendor_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS ix_finance_purchase_request_status
  ON finance_purchase_request(organization_id, status, created_at DESC);
