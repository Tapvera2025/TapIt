-- 0076 originally used equality checks for state-dependent fields. The
-- approved check accidentally rejected every pending claim because
-- (status = 'approved') = (rejection_reason IS NULL) evaluates to false for
-- a pending row with the normal NULL rejection reason.
ALTER TABLE expense_claim
  DROP CONSTRAINT IF EXISTS expense_claim_check,
  DROP CONSTRAINT IF EXISTS expense_claim_check1,
  DROP CONSTRAINT IF EXISTS expense_claim_check2,
  DROP CONSTRAINT IF EXISTS expense_claim_rejected_reason_check,
  DROP CONSTRAINT IF EXISTS expense_claim_pending_review_check,
  DROP CONSTRAINT IF EXISTS expense_claim_approved_reason_check;

ALTER TABLE expense_claim
  ADD CONSTRAINT expense_claim_rejected_reason_check
    CHECK (status <> 'rejected' OR (rejection_reason IS NOT NULL AND btrim(rejection_reason) <> '')),
  ADD CONSTRAINT expense_claim_pending_review_check
    CHECK (status <> 'pending' OR (reviewed_by IS NULL AND reviewed_at IS NULL)),
  ADD CONSTRAINT expense_claim_approved_reason_check
    CHECK (status <> 'approved' OR rejection_reason IS NULL);
