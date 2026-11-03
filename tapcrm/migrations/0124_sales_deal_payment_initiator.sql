-- Record the principal who confirmed an advance so segregation-of-duties
-- (see sod.ts `payment.initiatedBy`) has a field to read on the deal
-- resource. Without this, confirming an advance denies with "declared
-- initiator field \"payment.initiatedBy\" is absent from deal".

ALTER TABLE deal
  ADD COLUMN payment_initiated_by uuid,
  ADD CONSTRAINT deal_payment_initiated_by_fk
    FOREIGN KEY (organization_id, payment_initiated_by)
    REFERENCES app_user (organization_id, id);
