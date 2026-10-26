-- =====================================================================
-- 0098 — Finance / Accounting periods and close controls (P6 Phase 3)
-- =====================================================================

ALTER TABLE accounting_period
  ADD COLUMN bank_reconciled boolean NOT NULL DEFAULT false,
  ADD COLUMN aging_reconciled boolean NOT NULL DEFAULT false,
  ADD COLUMN payables_reconciled boolean NOT NULL DEFAULT false,
  ADD COLUMN gst_reconciled boolean NOT NULL DEFAULT false,
  ADD COLUMN trial_balance_reconciled boolean NOT NULL DEFAULT false,
  ADD COLUMN checklist_updated_by uuid,
  ADD COLUMN checklist_updated_at timestamptz,
  ADD CONSTRAINT fk_accounting_period_checklist_actor
    FOREIGN KEY (organization_id, checklist_updated_by)
    REFERENCES app_user (organization_id, id);

CREATE INDEX ix_accounting_period_close_status
  ON accounting_period (organization_id, status, period_start);
