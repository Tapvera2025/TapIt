-- =====================================================================
-- 0068 - Leave balances that mean something
--
-- Owner decision of 29 September 2026: yearly leave, pro-rated for joiners;
-- requests beyond the balance are refused when a type's limit is on; HR can
-- adjust a balance.
--
--   * The yearly entitlement is derived from leave_type.accrual_days and the
--     employee's joining and leaving dates, so it needs no rows here.
--   * Approved leave now always records its consumption (and a revocation its
--     reversal). They used to be written only while limits were enforced —
--     which could never be switched on — so every balance read zero used.
--   * HR adjustments are signed ledger entries with a reason and an author.
-- =====================================================================

ALTER TABLE leave_balance_entry DROP CONSTRAINT leave_balance_entry_kind_check;
ALTER TABLE leave_balance_entry
  ADD CONSTRAINT leave_balance_entry_kind_check
  CHECK (kind IN ('opening', 'accrual', 'consumption', 'reversal', 'adjustment'));

ALTER TABLE leave_balance_entry DROP CONSTRAINT leave_balance_entry_units_check;
ALTER TABLE leave_balance_entry
  ADD CONSTRAINT leave_balance_entry_units_check
  CHECK (units >= 0 OR kind = 'adjustment');

ALTER TABLE leave_balance_entry
  ADD COLUMN reason     text,
  ADD COLUMN created_by uuid;

ALTER TABLE leave_balance_entry
  ADD CONSTRAINT leave_balance_entry_adjustment_fields
  CHECK (
    kind <> 'adjustment'
    OR (units <> 0 AND created_by IS NOT NULL AND reason IS NOT NULL AND char_length(btrim(reason)) > 0)
  );

ALTER TABLE leave_balance_entry
  ADD CONSTRAINT leave_balance_entry_created_by_fkey
  FOREIGN KEY (organization_id, created_by) REFERENCES app_user(organization_id, id);

-- Approved absences that never recorded what they used.
INSERT INTO leave_balance_entry (organization_id, user_id, leave_type_id, kind, units, leave_request_id, period_year)
SELECT r.organization_id, r.user_id, r.leave_type_id, 'consumption', r.days_consumed, r.id,
       EXTRACT(YEAR FROM r.from_date)::smallint
FROM leave_request r
WHERE r.kind = 'absence'
  AND r.status = 'approved'
  AND r.days_consumed > 0
  AND NOT EXISTS (
    SELECT 1 FROM leave_balance_entry e
    WHERE e.organization_id = r.organization_id
      AND e.leave_request_id = r.id
      AND e.kind = 'consumption'
  );
